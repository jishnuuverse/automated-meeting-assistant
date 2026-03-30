import logging
import os
import re
import time
import asyncio
import tempfile
import subprocess
import wave
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

import torch
import whisper
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


logging.basicConfig(
	level=logging.INFO,
	format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("stt-service")

BASE_DIR = Path(__file__).resolve().parent
TRANSCRIPTS_DIR = BASE_DIR / "transcripts"
# Preferred model (try small first); fallback to base if loading fails due to memory
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL_NAME", "small")
WHISPER_MODEL_FALLBACK = os.getenv("WHISPER_MODEL_FALLBACK", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto").lower()
MAX_AUDIO_FILE_SIZE_MB = int(os.getenv("MAX_AUDIO_FILE_SIZE_MB", "200"))
MAX_AUDIO_FILE_SIZE_BYTES = MAX_AUDIO_FILE_SIZE_MB * 1024 * 1024
MAX_CONCURRENT_TRANSCRIPTIONS = int(os.getenv("MAX_CONCURRENT_TRANSCRIPTIONS", str(max(os.cpu_count() or 1, 2))))
transcription_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TRANSCRIPTIONS)
WHISPER_MODEL = None
ACTIVE_WHISPER_DEVICE = "cpu"


class TranscribeRequest(BaseModel):
	meetingId: str = Field(..., min_length=1)
	audioFilePath: str = Field(..., min_length=1)


def _sanitize_meeting_id(meeting_id: str) -> str:
	sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", meeting_id.strip())
	return sanitized or "meeting"


def _resolve_whisper_device() -> str:
	if WHISPER_DEVICE in {"cpu", "cuda"}:
		return WHISPER_DEVICE

	if torch.cuda.is_available():
		return "cuda"

	return "cpu"


@asynccontextmanager
async def lifespan(app: FastAPI):
	global WHISPER_MODEL
	global ACTIVE_WHISPER_DEVICE

	ACTIVE_WHISPER_DEVICE = _resolve_whisper_device()
	preferred = WHISPER_MODEL_NAME
	fallback = WHISPER_MODEL_FALLBACK
	loaded_model = None
	logger.info("Model loading started: attempting whisper '%s' on device '%s'", preferred, ACTIVE_WHISPER_DEVICE)
	try:
		WHISPER_MODEL = whisper.load_model(preferred, device=ACTIVE_WHISPER_DEVICE)
		loaded_model = preferred
	except Exception as e:
		logger.warning("Failed to load preferred model '%s': %s", preferred, str(e))
		if fallback and fallback != preferred:
			logger.info("Attempting fallback model '%s'", fallback)
			try:
				WHISPER_MODEL = whisper.load_model(fallback, device=ACTIVE_WHISPER_DEVICE)
				loaded_model = fallback
			except Exception as e2:
				logger.exception("Failed to load fallback model '%s': %s", fallback, str(e2))
				raise
		else:
			raise

	logger.info("Model loading completed: whisper '%s' on device '%s'", loaded_model, ACTIVE_WHISPER_DEVICE)
	yield


app = FastAPI(
	title="Local STT Service",
	lifespan=lifespan,
	docs_url=None if os.getenv("ENV", "production").lower() == "production" else "/docs",
	redoc_url=None if os.getenv("ENV", "production").lower() == "production" else "/redoc",
)


@app.post("/transcribe")
async def transcribe(request: TranscribeRequest):
	audio_path = Path(request.audioFilePath).expanduser().resolve()
	if not audio_path.exists() or not audio_path.is_file():
		raise HTTPException(
			status_code=400,
			detail=f"Audio file not found: {audio_path}",
		)

	file_size_bytes = audio_path.stat().st_size
	if file_size_bytes > MAX_AUDIO_FILE_SIZE_BYTES:
		raise HTTPException(
			status_code=413,
			detail=(
				f"Audio file is too large ({file_size_bytes} bytes). "
				f"Maximum allowed size is {MAX_AUDIO_FILE_SIZE_BYTES} bytes."
			),
		)

	try:
		logger.info(
			"Transcription start | meetingId=%s | audioFilePath=%s | sizeBytes=%s",
			request.meetingId,
			str(audio_path),
			file_size_bytes,
		)

		if WHISPER_MODEL is None:
			raise HTTPException(status_code=503, detail="Whisper model is not loaded yet.")

		# Convert audio to 16kHz mono WAV using ffmpeg into a temp file
		cleaned_audio_path = None
		audio_duration_seconds = None
		try:
			with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmpf:
				cleaned_audio_path = Path(tmpf.name)

			ffmpeg_cmd = [
				"ffmpeg",
				"-y",
				"-i",
				str(audio_path),
				"-ar",
				"16000",
				"-ac",
				"1",
				"-acodec",
				"pcm_s16le",
				str(cleaned_audio_path),
			]

			logger.info("Preprocessing audio with ffmpeg: %s", " ".join(ffmpeg_cmd))
			proc = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
			if proc.returncode != 0:
				logger.error("ffmpeg failed: %s", proc.stderr.decode(errors="ignore"))
				raise HTTPException(status_code=500, detail=f"Audio preprocessing failed: {proc.stderr.decode(errors='ignore')}")

			# Measure duration of cleaned WAV
			try:
				with contextlib.closing(wave.open(str(cleaned_audio_path), 'rb')) as wf:
					nframes = wf.getnframes()
					framerate = wf.getframerate()
					audio_duration_seconds = float(nframes) / float(framerate) if framerate else 0.0
			except Exception:
				audio_duration_seconds = None

			logger.info(
				"Preprocessed audio | meetingId=%s | cleanedPath=%s | durationSeconds=%s",
				request.meetingId,
				str(cleaned_audio_path),
				audio_duration_seconds,
			)

			# Run transcription on cleaned audio
			start_time = time.perf_counter()
			async with transcription_semaphore:
				result = await asyncio.to_thread(
					WHISPER_MODEL.transcribe,
					str(cleaned_audio_path),
					language="en",
					fp16=False,
					temperature=0,
				)
			duration_seconds = time.perf_counter() - start_time
			transcript = (result.get("text") or "").strip()
		finally:
			# Delete temporary cleaned audio
			if cleaned_audio_path and cleaned_audio_path.exists():
				try:
					cleaned_audio_path.unlink()
				except Exception:
					logger.debug("Failed to delete temp file %s", str(cleaned_audio_path))

		TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
		safe_meeting_id = _sanitize_meeting_id(request.meetingId)
		output_file = TRANSCRIPTS_DIR / f"meeting_{safe_meeting_id}.txt"
		output_file.write_text(transcript, encoding="utf-8")

		if not transcript:
			logger.warning(
				"Transcription completed with empty text | meetingId=%s | output=%s | durationSeconds=%.2f | device=%s",
				request.meetingId,
				str(output_file),
				duration_seconds,
				ACTIVE_WHISPER_DEVICE,
			)
			return {
				"success": True,
				"transcript": "",
				"warning": "Transcription completed but returned empty text.",
			}

		# Additional logging: transcription time and transcript length
		logger.info(
			"Transcription completion | meetingId=%s | output=%s | durationSeconds=%.2f | device=%s | audioDurationSeconds=%s | transcriptLength=%d",
			request.meetingId,
			str(output_file),
			duration_seconds,
			ACTIVE_WHISPER_DEVICE,
			audio_duration_seconds,
			len(transcript),
		)

		return {
			"success": True,
			"transcript": transcript,
		}
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("Transcription failed | meetingId=%s", request.meetingId)
		raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
