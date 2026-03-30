# Setup Guide — Automated Meeting Assistant

Complete setup instructions for Linux (Ubuntu 20.04+).

---

## Quick Start

```bash
# 1. Install dependencies
cd automation-service && npm install && npx playwright install chromium && cd ..
cd stt-service && npm install && cd ..
cd nlp-service && npm install && cd ..
cd frontend && npm install && cd ..
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# 2. Configure environment (see sections below)

# 3. Start all services (6 terminals)
ollama serve                                                        # Terminal 1
cd local-stt-service && source ../venv/bin/activate && uvicorn app:app --host 0.0.0.0 --port 6000  # Terminal 2
cd stt-service && node index.js                                     # Terminal 3
cd nlp-service && node index.js                                     # Terminal 4
cd automation-service && node src/server.js                         # Terminal 5
cd frontend && npm run dev                                          # Terminal 6

# 4. Open http://localhost:3000 and paste a Google Meet link!
```

---

## Detailed Steps

### 1. System Prerequisites

```bash
# Verify required software
node --version       # v18+
python3 --version    # 3.10+
ffmpeg -version
brave-browser --version
ollama --version
which xvfb-run

# Install anything missing
sudo apt update && sudo apt install -y ffmpeg pulseaudio xvfb python3-pip python3-venv curl
```

### 2. Install Node.js Dependencies

```bash
# Automation service (browser automation + recording)
cd automation-service
npm install
npx playwright install chromium
cd ..

# Hybrid STT service (AssemblyAI + local fallback)
cd stt-service
npm install
cd ..

# NLP service (summarization + Notion/Calendar integrations)
cd nlp-service
npm install
cd ..

# Frontend (React web UI)
cd frontend
npm install
cd ..
```

### 3. Install Python Dependencies

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Pull an Ollama Model

```bash
ollama serve &
ollama pull phi          # Lightweight, fast
# OR: ollama pull mistral  # More capable, needs more RAM
```

### 5. Configure Brave Browser

Find your Brave browser paths:

```bash
# Executable path
which brave-browser
# Usually: /usr/bin/brave-browser

# Profile path
ls ~/.config/BraveSoftware/Brave-Browser/
# Usually: ~/.config/BraveSoftware/Brave-Browser/Default
```

> **Important:** You must be logged into Google in Brave before running the automation. The service uses your existing browser profile for authentication.

### 6. Verify PulseAudio

```bash
# Check PulseAudio is running
pulseaudio --check && echo "Running" || (echo "Starting..." && pulseaudio --start)

# Find your monitor source
pactl list short sources
# Look for: alsa_output.pci-0000_00_05.0.analog-stereo.monitor

# If your source name is different, update it in:
# automation-service/src/joinMeeting.js (search for "monitor")
```

---

## Environment Configuration

### AssemblyAI (Cloud STT — Optional but Recommended)

Create `stt-service/.env`:

```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
```

Get an API key at [assemblyai.com](https://www.assemblyai.com/). Without this, the system falls back to local Whisper + Ollama.

### Notion Integration (Optional)

Create or update `nlp-service/.env`:

```env
NOTION_API_KEY=secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Setup steps:**
1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → Create new integration.
2. Copy the **Internal Integration Token** → set as `NOTION_API_KEY`.
3. Create a database in Notion (or use existing) with a **Title** property and a **Date** property called "Meeting Date".
4. Share the database with your integration (click "..." → "Add connections" → select your integration).
5. Copy the database ID from the URL → set as `NOTION_DATABASE_ID`.

### Google Calendar Integration (Optional)

Add to `nlp-service/.env`:

```env
GOOGLE_CLIENT_EMAIL=meeting-bot@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=your-email@gmail.com
```

**Setup steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create or select a project.
2. Enable the **Google Calendar API**.
3. Create a **Service Account** → Generate a JSON key file.
4. From the JSON key file, copy `client_email` → `GOOGLE_CLIENT_EMAIL` and `private_key` → `GOOGLE_PRIVATE_KEY`.
5. In Google Calendar settings, share your calendar with the service account email and grant **"Make changes to events"** permission.
6. Set `GOOGLE_CALENDAR_ID` to your calendar's email address (e.g., `your-email@gmail.com`).

---

## Starting the Services

Each service needs its own terminal. Start them in this order:

| # | Terminal | Command | Verify |
|---|---|---|---|
| 1 | Ollama | `ollama serve` | `curl http://localhost:11434/api/tags` |
| 2 | Local STT | `cd local-stt-service && source ../venv/bin/activate && uvicorn app:app --host 0.0.0.0 --port 6000` | First `/transcribe` call loads model |
| 3 | Hybrid STT | `cd stt-service && node index.js` | Console: `STT service (hybrid) running on port 5002` |
| 4 | NLP | `cd nlp-service && node index.js` | `curl http://localhost:7000/` |
| 5 | Automation | `cd automation-service && node src/server.js` | `curl http://localhost:4001/health` |
| 6 | Frontend | `cd frontend && npm run dev` | Open http://localhost:3000 |

---

## Verification

```bash
# Check all services
curl -s http://localhost:11434/api/tags | head -c 100   # Ollama
curl -s http://localhost:7000/                           # NLP
curl -s http://localhost:4001/health                     # Automation
curl -s http://localhost:3000 | head -c 100              # Frontend
```

---

## Usage

### Join a Meeting (Web UI)

1. Open **http://localhost:3000** in your browser.
2. Paste a Google Meet link (e.g., `https://meet.google.com/xxx-xxxx-xxx`).
3. Click **"Join Now"** for immediate join, or select a date/time and click **"Schedule Meeting"**.
4. A Brave browser window opens → camera/mic disabled → auto-joins the meeting.
5. When the meeting ends, transcription and summarization happen automatically.
6. View results on the Meeting Details page.

### Join a Meeting (API)

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

## Troubleshooting

### Port in use

```bash
lsof -ti:4001 | xargs kill -9   # Automation
lsof -ti:5002 | xargs kill -9   # STT
lsof -ti:6000 | xargs kill -9   # Local STT
lsof -ti:7000 | xargs kill -9   # NLP
lsof -ti:3000 | xargs kill -9   # Frontend
```

### Can't find Brave browser

```bash
which brave-browser
ls /usr/bin/brave*
find / -name "brave-browser" 2>/dev/null
```

### PulseAudio not running

```bash
pulseaudio --start
pactl list short sources
```

### Missing Node.js modules

```bash
cd <service-dir> && rm -rf node_modules && npm install
```

### Python virtual environment issues

```bash
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
