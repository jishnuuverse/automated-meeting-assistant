"""Pytest fixtures shared across test modules."""

from __future__ import annotations

import glob
from pathlib import Path

import pytest

RECORDINGS_DIR = Path(__file__).resolve().parent / "recordings"


def _discover_wav_files() -> list[Path]:
    """Return all .wav files under tests/recordings/."""
    return sorted(RECORDINGS_DIR.glob("*.wav"))


@pytest.fixture(scope="session")
def wav_file() -> Path:
    """Provide the first available .wav file from tests/recordings/.

    Skips the test automatically when no recording is present.
    """
    files = _discover_wav_files()
    if not files:
        pytest.skip("No .wav files found in tests/recordings/")
    return files[0]


@pytest.fixture(scope="session")
def all_wav_files() -> list[Path]:
    """Provide every .wav file from tests/recordings/."""
    files = _discover_wav_files()
    if not files:
        pytest.skip("No .wav files found in tests/recordings/")
    return files


@pytest.fixture(scope="session")
def tmp_output_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Session-scoped temporary directory for pipeline output."""
    return tmp_path_factory.mktemp("pipeline_output")
