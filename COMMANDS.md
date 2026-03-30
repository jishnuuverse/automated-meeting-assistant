# Command Reference — Automated Meeting Assistant

Quick-reference commands for Linux (bash).

---

## 🚀 Start All Services

```bash
# Terminal 1 — Ollama
ollama serve

# Terminal 2 — Local STT (Whisper)
cd local-stt-service
source ../venv/bin/activate
uvicorn app:app --host 0.0.0.0 --port 6000

# Terminal 3 — Hybrid STT
cd stt-service
node index.js

# Terminal 4 — NLP Service
cd nlp-service
node index.js

# Terminal 5 — Automation Service
cd automation-service
node src/server.js

# Terminal 6 — Frontend
cd frontend
npm run dev
```

---

## ✅ Health Checks

```bash
# Ollama
curl -s http://localhost:11434/api/tags | python3 -m json.tool

# NLP Service
curl -s http://localhost:7000/

# Automation Service
curl -s http://localhost:4001/health

# Hybrid STT Service
curl -s http://localhost:5002/

# Frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000

# All at once
echo "Ollama:    $(curl -s -o /dev/null -w '%{http_code}' http://localhost:11434/api/tags)"
echo "NLP:       $(curl -s -o /dev/null -w '%{http_code}' http://localhost:7000/)"
echo "Automation:$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4001/health)"
echo "STT:       $(curl -s -o /dev/null -w '%{http_code}' http://localhost:5002/)"
echo "Frontend:  $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"
```

---

## 🧪 Join a Meeting (API)

```bash
curl -X POST http://localhost:4001/api/meetings \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://meet.google.com/xxx-xxxx-xxx",
    "braveExecutable": "/usr/bin/brave-browser",
    "userDataDir": "/home/YOUR_USER/.config/BraveSoftware/Brave-Browser/Default"
  }'
```

---

## 📝 Transcribe a Meeting (API)

```bash
# Via hybrid STT service (AssemblyAI with local fallback)
curl -X POST http://localhost:5002/api/stt/process \
  -H "Content-Type: application/json" \
  -d '{
    "meetingId": "meeting-123456",
    "audioFilePath": "/absolute/path/to/recording.wav"
  }'
```

---

## 🧠 Summarize a Transcript (API)

```bash
curl -X POST http://localhost:7000/summarize \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Hello everyone, welcome to the meeting..."}'
```

---

## 📓 Notion — Create Meeting Page

```bash
curl -X POST http://localhost:7000/notion \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_date": "2026-03-01",
    "summary": "The team discussed Q1 goals...",
    "action_items": [
      {"task": "Review budget", "deadline": "2026-03-10"}
    ]
  }'
```

---

## 📅 Calendar — Create Events

```bash
curl -X POST http://localhost:7000/calendar \
  -H "Content-Type: application/json" \
  -d '{
    "action_items": [
      {"calendar_event_title": "Review budget", "calendar_event_date": "2026-03-10"}
    ]
  }'
```

---

## 🐍 Offline Pipeline

```bash
source venv/bin/activate

# Basic usage
python scripts/run_offline_test.py path/to/recording.wav

# With options
python scripts/run_offline_test.py recording.wav \
  --meeting-id "standup-2026-03-01" \
  --whisper-model small \
  --ollama-model phi \
  --output-dir ./results

# Debug mode
python scripts/run_offline_test.py recording.wav --log-level DEBUG
```

---

## 🧪 Run Tests

```bash
source venv/bin/activate

# All tests
pytest -v

# Specific test class
pytest tests/test_pipeline.py::TestTranscriber -v
pytest tests/test_pipeline.py::TestSummarizer -v
pytest tests/test_pipeline.py::TestStorage -v
pytest tests/test_pipeline.py::TestPipeline -v
```

---

## 🔍 Monitoring

```bash
# Check which ports are in use
ss -tlnp | grep -E '3000|4001|5002|6000|7000|11434'

# View latest meeting log
ls -t logs/join-*.log 2>/dev/null | head -1 | xargs cat

# View latest recording info
ls -lt logs/recordings/ | head -5

# View latest NLP analysis
ls -t nlp-service/transcripts/*.json 2>/dev/null | head -1 | xargs python3 -m json.tool

# Check Node.js processes
pgrep -a node

# Check PulseAudio sources
pactl list short sources
```

---

## 🎵 Audio Verification

```bash
# Check recording format
ffprobe logs/recordings/meeting-*.wav 2>&1 | grep -E "Stream|Duration"

# Expected output:
# Stream #0:0: Audio: pcm_s16le, 16000 Hz, mono, s16, 256 kb/s

# Convert audio to Whisper format manually
ffmpeg -i input.wav -ar 16000 -ac 1 -c:a pcm_s16le output.wav
```

---

## 🛑 Stop Services

```bash
# Kill by port
lsof -ti:3000 | xargs kill -9   # Frontend
lsof -ti:4001 | xargs kill -9   # Automation
lsof -ti:5002 | xargs kill -9   # STT
lsof -ti:6000 | xargs kill -9   # Local STT
lsof -ti:7000 | xargs kill -9   # NLP

# Kill all Node.js processes
pkill -f "node"

# Kill Ollama
pkill ollama
```

---

## 🧹 Cleanup

```bash
# Clear logs
rm -f logs/join-*.log logs/requests.log
rm -f automation-service/logs/*.log

# Clear recordings
rm -f logs/recordings/*.wav

# Clear transcripts
rm -f local-stt-service/transcripts/*.txt
rm -f nlp-service/transcripts/*.json
rm -f stt-service/transcripts/*

# Clear output
rm -f output/*.json

# Reinstall dependencies
rm -rf automation-service/node_modules && cd automation-service && npm install && cd ..
rm -rf stt-service/node_modules && cd stt-service && npm install && cd ..
rm -rf nlp-service/node_modules && cd nlp-service && npm install && cd ..
rm -rf frontend/node_modules && cd frontend && npm install && cd ..
```

---

## 🔧 Ollama Management

```bash
# Start Ollama
ollama serve

# List installed models
ollama list

# Pull models
ollama pull phi
ollama pull mistral

# Test generation
curl -s http://localhost:11434/api/generate \
  -d '{"model": "phi", "prompt": "Hello", "stream": false}' | python3 -m json.tool

# Delete a model
ollama rm phi
```

---

## 📊 Performance

```bash
# Measure API response time
time curl -s http://localhost:4001/health > /dev/null

# Check memory usage of Node processes
ps aux | grep node | grep -v grep | awk '{print $11, $6/1024 "MB"}'

# Check disk usage of recordings
du -sh logs/recordings/
```
