"""Persistence layer – save pipeline results to disk as JSON."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from app.config import OUTPUT_DIR

logger = logging.getLogger(__name__)


def _sanitize(name: str) -> str:
    """Remove characters that are unsafe for filenames."""
    return re.sub(r"[^a-zA-Z0-9_\-.]", "_", name.strip()) or "output"


def _ensure_dir(path: Path) -> Path:
    """Create directory (and parents) if it does not exist."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_result(
    result: Dict[str, Any],
    *,
    meeting_id: str | None = None,
    output_dir: str | Path | None = None,
) -> Path:
    """Persist a pipeline result dict as a timestamped JSON file.

    Parameters
    ----------
    result : dict
        The structured pipeline output to save.
    meeting_id : str, optional
        Human-readable identifier used in the filename.
    output_dir : str | Path, optional
        Override the default output directory.

    Returns
    -------
    Path
        Absolute path to the written JSON file.
    """
    out = Path(output_dir) if output_dir else OUTPUT_DIR
    _ensure_dir(out)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_id = _sanitize(meeting_id) if meeting_id else "meeting"
    filename = f"{safe_id}_{ts}.json"
    filepath = out / filename

    payload = {
        "meeting_id": meeting_id or "unknown",
        "created_at": ts,
        **result,
    }

    filepath.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Result saved → %s (%d bytes)", filepath, filepath.stat().st_size)
    return filepath


def load_result(filepath: str | Path) -> Dict[str, Any]:
    """Read a previously saved result JSON file."""
    path = Path(filepath).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Result file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))
