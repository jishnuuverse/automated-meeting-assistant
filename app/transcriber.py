"""Whisper-based audio transcription module."""

from __future__ import annotations

import logging
import subprocess
import tempfile
import time
import wave
from contextlib import closing
from pathlib import Path
from typing import Any, Dict

import torch
import whisper

from app.config import WHISPER_DEVICE, WHISPER_MODEL_NAME

logger = logging.getLogger(__name__)

_model_cache: dict[str, Any] = {}


def _resolve_device(requested: str) -> str:
    """Return 'cuda' when available and requested, otherwise 'cpu'."""
    if requested in ("cpu", "cuda"):
        return requested
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model(
    model_name: str | None = None,
    device: str | None = None,
) -> Any:
    """Load (and cache) a Whisper model."""
    model_name = model_name or WHISPER_MODEL_NAME
    device = _resolve_device(device or WHISPER_DEVICE)
    cache_key = f"{model_name}@{device}"

    if cache_key in _model_cache:
        logger.debug("Using cached Whisper model: %s", cache_key)
        return _model_cache[cache_key]

    logger.info("Loading Whisper model '%s' on device '%s' …", model_name, device)
    start = time.perf_counter()
    model = whisper.load_model(model_name, device=device)
    elapsed = time.perf_counter() - start
    logger.info("Whisper model loaded in %.2f s", elapsed)
    _model_cache[cache_key] = model
    return model


def _preprocess_audio(audio_path: Path) -> Path:
    """Convert audio to 16 kHz mono WAV via ffmpeg. Returns path to temp file."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    cmd = [
        "ffmpeg", "-y", "-i", str(audio_path),
        "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
        str(tmp_path),
    ]
    logger.debug("Running ffmpeg: %s", " ".join(cmd))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        stderr = proc.stderr.decode(errors="ignore")
        raise RuntimeError(f"ffmpeg preprocessing failed: {stderr}")
    return tmp_path


def _audio_duration(wav_path: Path) -> float | None:
    """Return duration in seconds for a WAV file, or None on failure."""
    try:
        with closing(wave.open(str(wav_path), "rb")) as wf:
            return float(wf.getnframes()) / float(wf.getframerate())
    except Exception:
        return None


def transcribe(
    audio_path: str | Path,
    *,
    model_name: str | None = None,
    device: str | None = None,
    language: str = "en",
) -> Dict[str, Any]:
    """Transcribe a .wav file and return structured result.

    Returns
    -------
    dict
        Keys: ``transcript`` (str), ``duration_audio_s`` (float | None),
        ``duration_processing_s`` (float), ``model`` (str), ``device`` (str).
    """
    audio_path = Path(audio_path).expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    if not audio_path.is_file():
        raise ValueError(f"Path is not a file: {audio_path}")

    model_name = model_name or WHISPER_MODEL_NAME
    device = _resolve_device(device or WHISPER_DEVICE)
    model = load_model(model_name, device)

    logger.info("Transcription start | file=%s | model=%s | device=%s", audio_path.name, model_name, device)

    cleaned_path: Path | None = None
    try:
        cleaned_path = _preprocess_audio(audio_path)
        audio_dur = _audio_duration(cleaned_path)

        start = time.perf_counter()
        result = model.transcribe(
            str(cleaned_path),
            language=language,
            fp16=(device == "cuda"),
            temperature=0,
        )
        proc_dur = time.perf_counter() - start
        transcript = (result.get("text") or "").strip()
    finally:
        if cleaned_path and cleaned_path.exists():
            cleaned_path.unlink(missing_ok=True)

    if not transcript:
        logger.warning("Transcription returned empty text for %s", audio_path.name)

    logger.info(
        "Transcription done | file=%s | chars=%d | audio_s=%s | proc_s=%.2f",
        audio_path.name,
        len(transcript),
        f"{audio_dur:.1f}" if audio_dur else "?",
        proc_dur,
    )

    return {
        "transcript": transcript,
        "duration_audio_s": audio_dur,
        "duration_processing_s": round(proc_dur, 3),
        "model": model_name,
        "device": device,
    }
