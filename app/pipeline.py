"""End-to-end offline meeting pipeline: transcribe → summarize → store."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Dict

from app import transcriber, summarizer, storage

logger = logging.getLogger(__name__)


def run(
    audio_path: str | Path,
    *,
    meeting_id: str | None = None,
    output_dir: str | Path | None = None,
    whisper_model: str | None = None,
    whisper_device: str | None = None,
    ollama_url: str | None = None,
    ollama_model: str | None = None,
    save: bool = True,
) -> Dict[str, Any]:
    """Execute the full offline pipeline.

    Steps
    -----
    1. Transcribe audio with Whisper.
    2. Summarize transcript with Ollama LLM.
    3. (Optional) Persist result to disk.

    Parameters
    ----------
    audio_path : str | Path
        Path to a ``.wav`` audio file.
    meeting_id : str, optional
        Identifier for the meeting (used in output filenames).
    output_dir : str | Path, optional
        Override the default output directory.
    whisper_model : str, optional
        Whisper model size (``tiny``, ``base``, ``small``, …).
    whisper_device : str, optional
        ``cpu``, ``cuda``, or ``auto``.
    ollama_url : str, optional
        Override the Ollama API endpoint.
    ollama_model : str, optional
        Override the Ollama model name.
    save : bool
        Whether to write the result JSON to disk (default ``True``).

    Returns
    -------
    dict
        Structured JSON-serialisable result with keys:
        ``transcript``, ``summary``, ``action_items``, ``important_dates``,
        ``cleaned_transcript``, ``output_file`` (if saved), and metadata.
    """
    audio_path = Path(audio_path).expanduser().resolve()
    mid = meeting_id or audio_path.stem
    pipeline_start = time.perf_counter()

    logger.info("Pipeline start | meeting_id=%s | audio=%s", mid, audio_path)

    # ── Step 1: Transcribe ───────────────────────────────────────────────
    logger.info("Step 1/3 – Transcription")
    tx_result = transcriber.transcribe(
        audio_path,
        model_name=whisper_model,
        device=whisper_device,
    )
    transcript_text: str = tx_result["transcript"]

    if not transcript_text:
        logger.warning("Transcription returned empty text; pipeline will continue with empty transcript.")

    # ── Step 2: Summarize ────────────────────────────────────────────────
    logger.info("Step 2/3 – Summarization")
    summary_result: Dict[str, Any] = {}
    try:
        summary_result = summarizer.summarize(
            transcript_text,
            ollama_url=ollama_url,
            ollama_model=ollama_model,
        )
    except ValueError as exc:
        logger.warning("Summarization skipped: %s", exc)
        summary_result = {
            "cleaned_transcript": transcript_text,
            "summary": "",
            "action_items": [],
            "important_dates": [],
        }

    # ── Step 3: Store ────────────────────────────────────────────────────
    pipeline_elapsed = round(time.perf_counter() - pipeline_start, 3)

    result: Dict[str, Any] = {
        "meeting_id": mid,
        "transcript": transcript_text,
        "cleaned_transcript": summary_result.get("cleaned_transcript", ""),
        "summary": summary_result.get("summary", ""),
        "action_items": summary_result.get("action_items", []),
        "important_dates": summary_result.get("important_dates", []),
        "metadata": {
            "whisper_model": tx_result.get("model"),
            "whisper_device": tx_result.get("device"),
            "audio_duration_s": tx_result.get("duration_audio_s"),
            "transcription_s": tx_result.get("duration_processing_s"),
            "pipeline_s": pipeline_elapsed,
        },
    }

    output_file: str | None = None
    if save:
        logger.info("Step 3/3 – Saving result")
        path = storage.save_result(result, meeting_id=mid, output_dir=output_dir)
        output_file = str(path)
        result["output_file"] = output_file
    else:
        logger.info("Step 3/3 – Skipped (save=False)")

    logger.info(
        "Pipeline complete | meeting_id=%s | elapsed=%.2f s | output=%s",
        mid,
        pipeline_elapsed,
        output_file or "(not saved)",
    )
    return result
