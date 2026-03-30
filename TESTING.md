# Testing Guide — Automated Meeting Assistant

---

## Prerequisites

Before running tests, ensure:

1. **Python virtual environment** is activated:
   ```bash
   source venv/bin/activate
   ```

2. **Ollama** is running with a model pulled:
   ```bash
   ollama serve &
   ollama pull phi
   ```

3. **ffmpeg** is installed:
   ```bash
   ffmpeg -version
   ```

4. **Test audio file** exists in `tests/recordings/`:
   ```bash
   ls tests/recordings/*.wav
   ```

---

## Running the Test Suite

```bash
source venv/bin/activate

# Run all tests
pytest

# Verbose output
pytest -v

# With short traceback
pytest -v --tb=short
```

### Run Specific Test Classes

```bash
pytest tests/test_pipeline.py::TestTranscriber -v
pytest tests/test_pipeline.py::TestSummarizer -v
pytest tests/test_pipeline.py::TestStorage -v
pytest tests/test_pipeline.py::TestPipeline -v
```

### Run Tests with Coverage

```bash
pytest --cov=app --cov-report=term-missing
```

---

## Test Coverage

| Test Class | # Tests | What It Validates |
|---|---|---|
| `TestTranscriber` | 3 | Whisper transcription output, metadata keys, file-not-found handling |
| `TestSummarizer` | 4 | LLM response keys, summary length, empty/short input validation |
| `TestStorage` | 3 | JSON save/load round-trip, directory creation, missing file errors |
| `TestPipeline` | 3 | Full end-to-end pipeline, no-save mode, JSON serialization |

### Test Configuration

Defined in `pytest.ini`:

```ini
[pytest]
testpaths = tests
timeout = 300
addopts = -v --tb=short
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
```

---

## Service Health Verification

### Quick Check — All Services

```bash
echo "=== Service Health Check ==="

# Ollama
curl -s http://localhost:11434/api/tags > /dev/null 2>&1 \
  && echo "✅ Ollama (11434)" || echo "❌ Ollama (11434)"

# Local STT
curl -s http://localhost:6000/docs > /dev/null 2>&1 \
  && echo "✅ Local STT (6000)" || echo "❌ Local STT (6000)"

# Hybrid STT
curl -s http://localhost:5002/ > /dev/null 2>&1 \
  && echo "✅ Hybrid STT (5002)" || echo "❌ Hybrid STT (5002)"

# NLP Service
curl -s http://localhost:7000/ > /dev/null 2>&1 \
  && echo "✅ NLP Service (7000)" || echo "❌ NLP Service (7000)"

# Automation Service
curl -s http://localhost:4001/health > /dev/null 2>&1 \
  && echo "✅ Automation (4001)" || echo "❌ Automation (4001)"

# Frontend
curl -s http://localhost:3000 > /dev/null 2>&1 \
  && echo "✅ Frontend (3000)" || echo "❌ Frontend (3000)"
```

### Individual Service Checks

```bash
# Automation service health
curl -s http://localhost:4001/health | python3 -m json.tool

# NLP service info
curl -s http://localhost:7000/ | python3 -m json.tool

# Hybrid STT info (includes AssemblyAI status)
curl -s http://localhost:5002/ | python3 -m json.tool

# Ollama models
curl -s http://localhost:11434/api/tags | python3 -m json.tool
```

---

## API Endpoint Tests

### Test Meeting Join

```bash
curl -X POST http://localhost:4001/api/meetings \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://meet.google.com/test-xxxx-xxx",
    "braveExecutable": "/usr/bin/brave-browser",
    "userDataDir": "/home/YOUR_USER/.config/BraveSoftware/Brave-Browser/Default"
  }' | python3 -m json.tool
```

**Expected:** `{"started": true, "pid": ..., "log": "..."}`

### Test Hybrid Transcription

```bash
curl -X POST http://localhost:5002/api/stt/process \
  -H "Content-Type: application/json" \
  -d '{
    "meetingId": "test-meeting-001",
    "audioFilePath": "/absolute/path/to/test.wav"
  }' | python3 -m json.tool
```

**Expected:** `{"success": true, "source": "assemblyai|local", "transcript": "...", "summary": {...}}`

### Test NLP Summarization

```bash
curl -X POST http://localhost:7000/summarize \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Hello everyone. Today we need to discuss the Q1 roadmap. John will prepare the budget by March 10. Sarah needs to finalize the design mockups by next Monday."}' \
  | python3 -m json.tool
```

**Expected:** `{"success": true, "result": {"cleaned_transcript": "...", "summary": "...", "action_items": [...]}}`

### Test Notion Integration

```bash
curl -X POST http://localhost:7000/notion \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_date": "2026-03-01",
    "summary": "Test meeting summary for Notion integration.",
    "action_items": [{"task": "Test task", "deadline": "2026-03-10"}]
  }' | python3 -m json.tool
```

### Test Calendar Integration

```bash
curl -X POST http://localhost:7000/calendar \
  -H "Content-Type: application/json" \
  -d '{
    "action_items": [
      {"calendar_event_title": "Test deadline", "calendar_event_date": "2026-03-10"}
    ]
  }' | python3 -m json.tool
```

---

## End-to-End Test (Web UI)

1. Open **http://localhost:3000**
2. Paste a Google Meet link
3. Click **"Join Now"**
4. **Expected behavior:**
   - Status shows "Joining meeting..."
   - Brave browser opens
   - Camera and mic are automatically disabled
   - "Ask to join" is clicked
5. After meeting ends:
   - Recording stops
   - Transcription runs (AssemblyAI or local Whisper)
   - Summarization runs (LeMUR or Ollama)
   - Results pushed to Notion/Calendar (if configured)
   - Transcript and summary visible in the frontend

---

## Verify Recordings

```bash
# List recent recordings
ls -lt logs/recordings/ | head -5

# Check format of a recording
ffprobe logs/recordings/meeting-*.wav 2>&1 | grep -E "Stream|Duration"

# Expected:
# Stream #0:0: Audio: pcm_s16le, 16000 Hz, mono, s16, 256 kb/s
```

---

## Check Logs

```bash
# Latest meeting join log
ls -t logs/join-*.log 2>/dev/null | head -1 | xargs cat

# Latest NLP analysis
ls -t nlp-service/transcripts/*.json 2>/dev/null | head -1 | xargs python3 -m json.tool

# Request log
tail -20 logs/requests.log
```

---

## Performance Testing

```bash
# API response time
time curl -s http://localhost:4001/health > /dev/null

# Node process memory
ps aux | grep "node" | grep -v grep | awk '{printf "%-40s %s MB\n", $11, $6/1024}'
```

---

## Troubleshooting Test Failures

### Tests timeout (> 300s)

- Whisper model may be downloading on first run
- Pre-download: `python3 -c "import whisper; whisper.load_model('base')"`
- Or use a smaller model: `export WHISPER_MODEL_NAME=tiny`

### Ollama connection errors

```bash
ollama serve &
curl http://localhost:11434/api/tags
ollama pull phi
```

### No test audio files

Place a `.wav` file in `tests/recordings/`. Any short audio clip will work.

### Python import errors

```bash
source venv/bin/activate
pip install -r requirements.txt
```
