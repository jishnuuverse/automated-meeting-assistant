"""Centralized configuration for the offline testing pipeline."""

import os
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "output"
TESTS_RECORDINGS_DIR = BASE_DIR / "tests" / "recordings"

# ── Whisper ──────────────────────────────────────────────────────────────────
WHISPER_MODEL_NAME: str = os.getenv("WHISPER_MODEL_NAME", "base")
WHISPER_DEVICE: str = os.getenv("WHISPER_DEVICE", "auto")

# ── Ollama / LLM ────────────────────────────────────────────────────────────
OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "phi")
OLLAMA_TIMEOUT_S: int = int(os.getenv("OLLAMA_TIMEOUT_S", "180"))
MIN_TRANSCRIPT_LENGTH: int = int(os.getenv("MIN_TRANSCRIPT_LENGTH", "50"))
MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "2"))

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
