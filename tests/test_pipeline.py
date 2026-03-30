"""End-to-end tests for the offline meeting-assistant pipeline.

Requirements
------------
- At least one ``.wav`` file must exist in ``tests/recordings/``.
- Ollama must be running locally (``ollama serve``) with the configured model
  pulled (default: ``mistral``).
- Whisper Python package + ffmpeg must be installed.

Run
---
    pytest tests/test_pipeline.py -v
    pytest tests/test_pipeline.py -v -k "test_full_pipeline"
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import transcriber, summarizer, storage, pipeline


# ─────────────────────────────────────────────────────────────────────────────
# Transcriber tests
# ─────────────────────────────────────────────────────────────────────────────

class TestTranscriber:
    """Validate the Whisper transcription module."""

    def test_transcribe_returns_non_empty(self, wav_file: Path) -> None:
        result = transcriber.transcribe(wav_file)
        assert isinstance(result, dict)
        assert "transcript" in result
        assert isinstance(result["transcript"], str)
        assert len(result["transcript"]) > 0, "Transcript must not be empty."

    def test_transcribe_metadata_keys(self, wav_file: Path) -> None:
        result = transcriber.transcribe(wav_file)
        for key in ("duration_audio_s", "duration_processing_s", "model", "device"):
            assert key in result, f"Missing metadata key: {key}"

    def test_transcribe_file_not_found(self) -> None:
        with pytest.raises(FileNotFoundError):
            transcriber.transcribe("/nonexistent/path/audio.wav")


# ─────────────────────────────────────────────────────────────────────────────
# Summarizer tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSummarizer:
    """Validate the LLM summarization module."""

    def test_summarize_returns_expected_keys(self, wav_file: Path) -> None:
        tx = transcriber.transcribe(wav_file)
        result = summarizer.summarize(tx["transcript"])
        assert isinstance(result, dict)
        for key in ("summary", "cleaned_transcript", "action_items", "important_dates"):
            assert key in result, f"Missing key: {key}"

    def test_summary_length(self, wav_file: Path) -> None:
        tx = transcriber.transcribe(wav_file)
        result = summarizer.summarize(tx["transcript"])
        assert len(result["summary"]) > 50, (
            f"Summary too short ({len(result['summary'])} chars); expected > 50."
        )

    def test_summarize_empty_input_raises(self) -> None:
        with pytest.raises(ValueError):
            summarizer.summarize("")

    def test_summarize_short_input_raises(self) -> None:
        with pytest.raises(ValueError):
            summarizer.summarize("too short")


# ─────────────────────────────────────────────────────────────────────────────
# Storage tests
# ─────────────────────────────────────────────────────────────────────────────

class TestStorage:
    """Validate the JSON persistence layer."""

    def test_save_and_load(self, tmp_output_dir: Path) -> None:
        payload = {"summary": "test", "action_items": []}
        path = storage.save_result(payload, meeting_id="unit-test", output_dir=tmp_output_dir)
        assert path.exists()
        loaded = storage.load_result(path)
        assert loaded["summary"] == "test"

    def test_save_creates_directory(self, tmp_path: Path) -> None:
        nested = tmp_path / "a" / "b" / "c"
        payload = {"summary": "nested"}
        path = storage.save_result(payload, meeting_id="nest", output_dir=nested)
        assert path.exists()

    def test_load_missing_file_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            storage.load_result("/nonexistent/result.json")


# ─────────────────────────────────────────────────────────────────────────────
# Full pipeline tests
# ─────────────────────────────────────────────────────────────────────────────

class TestPipeline:
    """End-to-end pipeline validation."""

    def test_full_pipeline(self, wav_file: Path, tmp_output_dir: Path) -> None:
        result = pipeline.run(
            wav_file,
            meeting_id="pytest-e2e",
            output_dir=tmp_output_dir,
            save=True,
        )

        # Structural assertions
        assert isinstance(result, dict)
        assert "transcript" in result
        assert "summary" in result
        assert "action_items" in result
        assert "important_dates" in result
        assert "metadata" in result
        assert "output_file" in result

        # Content assertions
        assert len(result["transcript"]) > 0, "Transcript must not be empty."
        assert len(result["summary"]) > 50, (
            f"Summary too short ({len(result['summary'])} chars); expected > 50."
        )
        assert isinstance(result["action_items"], list)
        assert isinstance(result["important_dates"], list)

        # File written
        output_path = Path(result["output_file"])
        assert output_path.exists(), "Output JSON file was not created."
        saved = json.loads(output_path.read_text())
        assert saved["meeting_id"] == "pytest-e2e"

    def test_pipeline_no_save(self, wav_file: Path) -> None:
        result = pipeline.run(wav_file, save=False)
        assert "output_file" not in result
        assert len(result["transcript"]) > 0

    def test_pipeline_result_is_json_serializable(self, wav_file: Path) -> None:
        result = pipeline.run(wav_file, save=False)
        serialized = json.dumps(result)
        assert isinstance(serialized, str)
        assert len(serialized) > 0
