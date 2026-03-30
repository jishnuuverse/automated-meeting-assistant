#!/usr/bin/env python3
"""CLI script to run the offline meeting-assistant pipeline.

Usage
-----
    python scripts/run_offline_test.py tests/recordings/sample.wav
    python scripts/run_offline_test.py tests/recordings/sample.wav --meeting-id demo1
    python scripts/run_offline_test.py tests/recordings/sample.wav --output-dir /tmp/results
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Ensure the project root is on sys.path so ``app`` is importable when
# the script is executed directly (e.g. ``python scripts/run_offline_test.py``).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from app.config import LOG_FORMAT, LOG_LEVEL  # noqa: E402
from app.pipeline import run as run_pipeline  # noqa: E402


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the offline meeting-assistant pipeline on a .wav file.",
    )
    parser.add_argument(
        "audio_file",
        type=str,
        help="Path to the .wav audio file.",
    )
    parser.add_argument(
        "--meeting-id",
        type=str,
        default=None,
        help="Optional meeting identifier (defaults to the filename stem).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Directory to save the result JSON (defaults to <project>/output/).",
    )
    parser.add_argument(
        "--whisper-model",
        type=str,
        default=None,
        help="Whisper model size: tiny, base, small, medium, large.",
    )
    parser.add_argument(
        "--whisper-device",
        type=str,
        default=None,
        help="Device for Whisper: cpu, cuda, or auto.",
    )
    parser.add_argument(
        "--ollama-url",
        type=str,
        default=None,
        help="Ollama API URL override.",
    )
    parser.add_argument(
        "--ollama-model",
        type=str,
        default=None,
        help="Ollama model name override.",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Do not write the result to disk.",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default=LOG_LEVEL,
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    logging.basicConfig(level=args.log_level, format=LOG_FORMAT, force=True)
    logger = logging.getLogger("run_offline_test")

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        logger.error("Audio file not found: %s", audio_path)
        return 1

    try:
        result = run_pipeline(
            audio_path,
            meeting_id=args.meeting_id,
            output_dir=args.output_dir,
            whisper_model=args.whisper_model,
            whisper_device=args.whisper_device,
            ollama_url=args.ollama_url,
            ollama_model=args.ollama_model,
            save=not args.no_save,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
