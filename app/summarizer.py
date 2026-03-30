"""LLM-based meeting transcript summarization module (Ollama)."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List
from datetime import datetime

import requests

from app.config import (
    MAX_RETRIES,
    MIN_TRANSCRIPT_LENGTH,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_S,
    OLLAMA_URL,
)

logger = logging.getLogger(__name__)


# ── Prompt ───────────────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """\
You are an assistant for meeting post-processing.

Task:
1) Clean minor transcription errors while preserving original meaning.
2) Produce a concise meeting summary.
3) Extract action items.
4) Extract deadlines and dates mentioned.
5) Extract responsible person names when available.

Return strictly valid JSON only. Do not include markdown, code fences, comments, or any extra text.
Include a cleaned transcript of the meeting under the key 'cleaned_transcript'.
Use exactly this schema:
{{
  "cleaned_transcript": "string",
  "summary": "string",
  "action_items": [
    {{
      "task": "string",
      "responsible": "string",
      "deadline": "string"
    }}
  ],
  "important_dates": ["string"]
}}

Rules:
- If a value is unknown, use an empty string for fields or an empty array for lists.
- Keep summary concise (3-6 sentences max).
- action_items must be an array, even if empty.
- important_dates must contain date/deadline references mentioned in the transcript.

Transcript:
{transcript}"""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _preprocess(text: str) -> str:
    """Normalize whitespace and remove duplicate adjacent words."""
    if not text:
        return ""
    out = re.sub(r"\s+", " ", text).strip()
    out = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", out, flags=re.IGNORECASE)
    out = re.sub(r"\s+([?.!,;:])", r"\1", out)
    return out


def _parse_llm_json(raw: str) -> Dict[str, Any]:
    """Extract and parse JSON from the model response."""
    if not raw or not raw.strip():
        raise ValueError("LLM returned an empty response.")
    trimmed = raw.strip()
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        first = trimmed.find("{")
        last = trimmed.rfind("}")
        if first >= 0 and last > first:
            return json.loads(trimmed[first : last + 1])
        raise ValueError("LLM response was not valid JSON.")


def _normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure the parsed result conforms to the expected schema."""
    # Ensure cleaned_transcript is normalized whitespace
    cleaned = _preprocess(parsed.get("cleaned_transcript", "") or "")
    return {
        "cleaned_transcript": cleaned,
        "summary": parsed.get("summary", "") or "",
        "action_items": [
            {
                "task": item.get("task", "") or "",
                "responsible": item.get("responsible", "") or "",
                "deadline": item.get("deadline", "") or "",
            }
            for item in (parsed.get("action_items") or [])
            if isinstance(item, dict)
        ],
        "important_dates": [
            str(d) for d in (parsed.get("important_dates") or [])
        ],
    }


def _find_dates(text: str) -> List[str]:
    """Rudimentary date finder for common formats (e.g. February 26, 2026)."""
    if not text:
        return []
    month_names = r"January|February|March|April|May|June|July|August|September|October|November|December"
    # Matches 'February 26, 2026', 'March 1, 2026 to March 3, 2026', 'Feb 26 2026'
    patterns = [
        rf"\b({month_names})\s+\d{{1,2}},?\s*\d{{4}}(?:\s+to\s+({month_names})\s+\d{{1,2}},?\s*\d{{4}})?",
        r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",
    ]
    found: List[str] = []
    for p in patterns:
        for m in re.finditer(p, text):
            found.append(m.group(0))
    # Deduplicate while preserving order
    seen = set()
    out = []
    for d in found:
        if d not in seen:
            out.append(d)
            seen.add(d)
    return out


def _is_valid_date_token(token: str) -> bool:
    """Return True if token is a valid date or date range in supported formats.

    Supported single date formats: 'February 26, 2026', 'Feb 26, 2026', '2/26/2026'
    Supported ranges: '<date> to <date>' where both sides validate.
    """
    if not token or not token.strip():
        return False
    token = token.strip()
    # Handle ranges like 'March 1, 2026 to March 3, 2026'
    if " to " in token:
        parts = [p.strip() for p in token.split(" to ")]
        if len(parts) != 2:
            return False
        return _is_valid_date_token(parts[0]) and _is_valid_date_token(parts[1])

    # Try parsing common verbose formats
    formats = ["%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y", "%m/%d/%Y", "%d/%m/%Y"]
    for fmt in formats:
        try:
            dt = datetime.strptime(token, fmt)
            # Reject dates that are clearly out of reasonable bounds
            if dt.year < 1900 or dt.year > datetime.utcnow().year + 5:
                return False
            return True
        except Exception:
            continue
    return False


def _fallback_extract(parsed: Dict[str, Any], cleaned: str) -> Dict[str, Any]:
    """Fill missing fields using simple heuristics when the LLM returns empties."""
    result = parsed.copy()

    # Summary fallback: take first 2 sentences if summary empty
    if not (result.get("summary") or ""):
        sentences = re.split(r"(?<=[.!?])\s+", cleaned)
        summary_candidates = [s.strip() for s in sentences if s.strip()]
        result["summary"] = " ".join(summary_candidates[:2]) if summary_candidates else ""

    # Important dates fallback
    if not (result.get("important_dates") or []):
        dates = [d for d in _find_dates(cleaned) if _is_valid_date_token(d)]
        result["important_dates"] = dates

    # Action items fallback: look for sentences containing action keywords
    if not (result.get("action_items") or []):
        keywords = [r"request", r"please", r"ensure", r"target", r"schedule", r"scheduled", r"finalize", r"upload", r"complete"]
        sentences = re.split(r"(?<=[.!?])\s+", cleaned)
        items = []
        for s in sentences:
            low = s.lower()
            if any(k in low for k in keywords):
                # find date inside sentence if any and validate
                dates = [d for d in _find_dates(s) if _is_valid_date_token(d)]
                items.append({
                    "task": _preprocess(s.strip()),
                    "responsible": "",
                    "deadline": dates[0] if dates else "",
                })
        result["action_items"] = items

    return result


# ── Public API ───────────────────────────────────────────────────────────────

def summarize(
    transcript: str,
    *,
    ollama_url: str | None = None,
    ollama_model: str | None = None,
    timeout_s: int | None = None,
    max_retries: int | None = None,
) -> Dict[str, Any]:
    """Send a transcript to the Ollama LLM and return a structured summary.

    Returns
    -------
    dict
        Keys: ``cleaned_transcript``, ``summary``, ``action_items``,
        ``important_dates``.
    """
    if not isinstance(transcript, str) or not transcript.strip():
        raise ValueError("transcript must be a non-empty string.")

    cleaned = _preprocess(transcript)
    if len(cleaned) < MIN_TRANSCRIPT_LENGTH:
        raise ValueError(
            f"Transcript too short ({len(cleaned)} chars); "
            f"minimum is {MIN_TRANSCRIPT_LENGTH}."
        )

    url = ollama_url or OLLAMA_URL
    model = ollama_model or OLLAMA_MODEL
    timeout = timeout_s or OLLAMA_TIMEOUT_S
    retries = max_retries if max_retries is not None else MAX_RETRIES

    prompt = _PROMPT_TEMPLATE.format(transcript=cleaned)
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        logger.info(
            "Summarization attempt %d/%d | model=%s | transcript_len=%d",
            attempt, retries, model, len(cleaned),
        )
        start = time.perf_counter()
        try:
            resp = requests.post(
                url,
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                },
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            raw_text = data.get("response", "")
            logger.debug("LLM raw response: %s", raw_text)
            parsed = _parse_llm_json(raw_text)
            result = _normalize(parsed)
            # If important fields are empty, apply a simple fallback extractor
            if not result.get("summary") or not result.get("action_items") or not result.get("important_dates"):
                logger.debug("LLM returned empty structured fields, applying fallback extractor.")
                parsed_fallback = _fallback_extract(parsed, cleaned)
                result = _normalize(parsed_fallback)
            elapsed = time.perf_counter() - start
            logger.info("Summarization done in %.2f s", elapsed)
            return result

        except requests.exceptions.Timeout:
            last_error = TimeoutError(
                f"Ollama request timed out after {timeout}s (attempt {attempt})."
            )
        except Exception as exc:
            last_error = RuntimeError(
                f"Summarization failed (attempt {attempt}): {exc}"
            )

        logger.warning("Attempt %d failed: %s", attempt, last_error)

    raise last_error  # type: ignore[misc]
