# Automated Meeting Assistant

Automates meeting join, recording, transcription, summarization, and task sync so notes and deadlines are created without manual post-meeting work.

---

## 1. PROJECT TITLE AND TAGLINE

### Automated Meeting Assistant

Automates meeting capture and post-processing into transcript, summary, action items, Notion page, and Google Calendar deadlines.

---

## 2. WHAT IT DOES

The app starts a meeting bot through Playwright and Brave, then records system audio using PulseAudio and ffmpeg.
Audio goes to a hybrid STT pipeline: AssemblyAI cloud first, with local Whisper fallback through the FastAPI service on port 6000.
Summarization uses AssemblyAI LeMUR first in the STT orchestrator, and uses Groq or Ollama fallback paths based on mode and availability.
Final meeting insights can be pushed to Notion (page + tasks table) and Google Calendar (deadline events).

---

## 3. ARCHITECTURE DIAGRAM

```mermaid
flowchart LR
  A[Frontend\nReact + Vite\n:3000]
  B[Automation Service\nNode.js + Express\n:4001]
  C[Audio Recording\nPulseAudio monitor + ffmpeg]
  D[Cloud STT\nAssemblyAI\n:5002]
  E[Local STT\nWhisper + FastAPI\n:6000]
  F[NLP Service\nGroq or Ollama\n:7000]
  G[Notion Page]
  H[Google Calendar Events]

  A --> B --> C
  C --> D
  C --> E
  D --> F
  E --> F
  F --> G
  F --> H
```

Data flow in runtime:

1. Frontend submits meeting request to automation service (`POST /api/meetings`).
2. Automation joins the meeting and starts ffmpeg recording from PulseAudio monitor.
3. On meeting end, audio path is sent to STT orchestrator (`/api/stt/process`).
4. STT tries AssemblyAI cloud first; local Whisper fallback is used when needed.
5. Summarization result is generated through LeMUR, Groq, or Ollama based on fallback path.
6. Integrations endpoint receives summary payload and writes Notion + Calendar outputs.

---

## 4. TECH STACK TABLE

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React | User interface and meeting form pages |
| Frontend Build | Vite | Dev server and frontend bundling |
| Backend Runtime | Node.js | Runs automation, STT, and NLP services |
| Backend Framework | Express | HTTP APIs for automation, STT, NLP |
| Browser Automation | Playwright | Drives browser actions in meetings |
| Browser | Brave Browser | Persistent signed-in meeting profile |
| Audio Capture | PulseAudio | System audio monitor source |
| Audio Capture | ffmpeg | Records WAV audio from monitor source |
| Cloud STT | AssemblyAI | Primary cloud transcription |
| Local STT | OpenAI Whisper | Local fallback transcription |
| Local STT API | FastAPI | Exposes local `/transcribe` endpoint |
| Python Runtime | Python | Runs local STT and offline pipeline |
| Cloud LLM | Groq API | Cloud summarization fallback path |
| Groq Model | Llama3 (`llama-3.3-70b-versatile`) | Default Groq summarization model |
| Local LLM Runtime | Ollama | Local summarization backend |
| Local LLM Model | Phi (`phi`) | Default Ollama summarization model |
| Knowledge Integration | Notion API | Creates meeting pages and tasks table |
| Calendar Integration | Google Calendar API | Creates deadline events |
| Date Parsing | chrono-node | Resolves natural language deadlines |
| Google SDK | googleapis | Auth + event creation for Calendar |
| Notion SDK | @notionhq/client | Notion database and page operations |

---

## 5. SERVICES TABLE

| Service | Port | Language | Responsibility |
|---|---:|---|---|
| Frontend | 3000 | React | User interface |
| Automation Service | 4001 | Node.js | Browser control + audio recording |
| Cloud STT | 5002 | Node.js | AssemblyAI integration + fallback orchestration |
| Local STT | 6000 | Python/FastAPI | Whisper transcription |
| NLP Service | 7000 | Node.js | Groq/Ollama summarization, Notion, Calendar integration |

---

## 6. HYBRID PIPELINE EXPLANATION

Code-verified behavior combines STT fallback (`stt-service/orchestrator.js`) with NLP fallback (`nlp-service/summarizer.js`).

### Level 1

AssemblyAI transcription + AssemblyAI LeMUR summarization.

- Source returned: `assemblyai`
- Used when cloud transcription and LeMUR both succeed

### Level 2

AssemblyAI transcription + Groq summarization.

- Used when LeMUR path fails and summarization is delegated through NLP in cloud mode
- Requires `GROQ_API_KEY`

### Level 3

AssemblyAI transcription + Ollama summarization.

- Used when LeMUR is unavailable and Groq is unavailable or fails
- Source returned can appear as `assemblyai+ollama`

### Level 4

Local Whisper transcription + Ollama summarization (full local fallback).

- Triggered when AssemblyAI transcription fails, or when private/local mode is explicitly selected
- Source returned: `local`

Notes:

- In cloud mode, local Whisper + Groq can also occur when AssemblyAI fails but Groq is available in NLP fallback logic.
- In private/local mode, Groq is intentionally skipped and Ollama is used directly.

---

## 7. PREREQUISITES

- Node.js v20+
- Python 3.10+
- Brave Browser installed
- Ollama installed with `phi` model pulled
- PulseAudio (Linux)
- xvfb (for headless display on cloud/server)
- Google account with a persistent profile already signed in
- API keys and credentials:
  - AssemblyAI
  - Groq
  - Notion
  - Google service account

Verification commands:

```bash
node --version
python3 --version
brave-browser --version
ffmpeg -version
pulseaudio --check
which xvfb-run
ollama --version
```

Install Ubuntu dependencies:

```bash
sudo apt update
sudo apt install -y ffmpeg pulseaudio xvfb python3-pip python3-venv curl
```

Install Ollama and pull model:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve
ollama pull phi
```

---

## 8. ENVIRONMENT VARIABLES TABLE

No `.env.example` exists in this repo.
Variables below are taken from code usage across services.

| Variable | Service | Required | Description |
|---|---|---|---|
| ASSEMBLYAI_API_KEY | stt-service | Yes (cloud STT) | AssemblyAI API key |
| ASSEMBLYAI_TIMEOUT_MS | stt-service | No | AssemblyAI request timeout in ms |
| LOCAL_STT_URL | stt-service | No | Local STT endpoint URL |
| LOCAL_STT_TIMEOUT_MS | stt-service | No | Local STT timeout in ms |
| NLP_INTEGRATIONS_URL | stt-service | No | NLP integrations ingest URL |
| OPENAI_API_KEY | stt-service | No | Legacy/openai path variable |
| PORT | automation-service | No | Automation service port (default 4001) |
| STT_ENDPOINT | automation-service | No | STT process endpoint |
| NLP_ENDPOINT | automation-service | No | NLP summarize endpoint |
| NLP_TIMEOUT_MS | automation-service | No | NLP timeout in ms |
| STT_REQUEST_RETRIES | automation-service | No | STT retry count |
| STT_RETRY_DELAY_MS | automation-service | No | STT retry delay in ms |
| NLP_TRANSCRIPTS_DIR | automation-service | No | Output path for NLP analysis JSON |
| PULSE_MONITOR_SOURCE | automation-service | No | PulseAudio monitor source name |
| PROCESSING_MODE | automation-service | No | `cloud` or `local` mode for pipeline |
| LOG_LEVEL | automation-service | No | Logger verbosity |
| MS_TENANT_ID | automation-service | No | Teams adapter tenant ID |
| MS_CLIENT_ID | automation-service | No | Teams adapter client ID |
| MS_CLIENT_SECRET | automation-service | No | Teams adapter secret |
| ZOOM_API_KEY | automation-service | No | Zoom adapter API key |
| ZOOM_API_SECRET | automation-service | No | Zoom adapter API secret |
| ZOOM_ACCOUNT_ID | automation-service | No | Zoom adapter account ID |
| PORT | stt-service | No | STT service port (default 5002) |
| PORT | nlp-service | No | NLP service port (default 7000) |
| NOTION_API_KEY | nlp-service | Yes (Notion integration) | Notion integration token |
| NOTION_DATABASE_ID | nlp-service | Yes (Notion integration) | Target Notion database ID |
| GOOGLE_CLIENT_EMAIL | nlp-service | Yes (Calendar integration) | Google service account email |
| GOOGLE_PRIVATE_KEY | nlp-service | Yes (Calendar integration) | Service account private key |
| GOOGLE_CALENDAR_ID | nlp-service | Yes (Calendar integration) | Calendar ID for event creation |
| GROQ_API_KEY | nlp-service | No (required for Groq path) | Groq API key |
| GROQ_MODEL | nlp-service | No | Groq model name |
| OLLAMA_PRIVATE_TIMEOUT_MS | nlp-service | No | Local/private mode Ollama timeout |
| WHISPER_MODEL_NAME | local-stt-service | No | Preferred Whisper model |
| WHISPER_MODEL_FALLBACK | local-stt-service | No | Fallback Whisper model |
| WHISPER_DEVICE | local-stt-service | No | `cpu`, `cuda`, or `auto` |
| MAX_AUDIO_FILE_SIZE_MB | local-stt-service | No | Max upload size |
| MAX_CONCURRENT_TRANSCRIPTIONS | local-stt-service | No | Semaphore limit for transcriptions |
| ENV | local-stt-service | No | Controls FastAPI docs exposure |
| VITE_AUTOMATION_URL | frontend | No | Frontend target for automation API |
| VITE_STT_URL | frontend | No | Frontend target for STT API |
| VITE_NLP_URL | frontend | No | Frontend target for NLP API |
| WHISPER_MODEL_NAME | offline Python app | No | Offline pipeline Whisper model |
| WHISPER_DEVICE | offline Python app | No | Offline pipeline device |
| OLLAMA_URL | offline Python app | No | Offline pipeline Ollama URL |
| OLLAMA_MODEL | offline Python app | No | Offline pipeline Ollama model |
| OLLAMA_TIMEOUT_S | offline Python app | No | Offline pipeline timeout |
| MIN_TRANSCRIPT_LENGTH | offline Python app | No | Min transcript length |
| MAX_RETRIES | offline Python app | No | Retry count |
| LOG_LEVEL | offline Python app | No | Offline pipeline logging level |
| GOOGLE_SERVICE_ACCOUNT_EMAIL | nlp-service | No (alias note) | Not used in code; use `GOOGLE_CLIENT_EMAIL` |

Minimal `.env` examples:

`stt-service/.env`

```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
```

`nlp-service/.env`

```env
NOTION_API_KEY=your_notion_api_key
NOTION_DATABASE_ID=your_notion_database_id
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
```

`automation-service/.env`

```env
STT_ENDPOINT=http://127.0.0.1:5002/api/stt/process
NLP_ENDPOINT=http://127.0.0.1:7000/summarize
PULSE_MONITOR_SOURCE=alsa_output.pci-0000_00_05.0.analog-stereo.monitor
PROCESSING_MODE=cloud
```

---

## 9. SETUP INSTRUCTIONS

### Step 1: Clone the repo

```bash
git clone <your-repo-url>
cd automated-meeting-assistant
```

### Step 2: Install dependencies for each service

Install Python dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Install Node dependencies from each service `package.json`:

```bash
npm install
cd automation-service && npm install && cd ..
cd stt-service && npm install && cd ..
cd nlp-service && npm install && cd ..
cd frontend && npm install && cd ..
```

Install Playwright browser used by automation service:

```bash
cd automation-service
npx playwright install chromium
cd ..
```

### Step 3: Set up `.env` files

Create and fill:

- `automation-service/.env`
- `stt-service/.env`
- `nlp-service/.env`

Use the variables listed in Section 8.

### Step 4: Start services in order

1) Start Ollama first:

```bash
ollama serve
```

2) Pull model once (if not already pulled):

```bash
ollama pull phi
```

3) Start local STT service:

```bash
cd local-stt-service
uvicorn app:app --host 0.0.0.0 --port 6000
```

4) Start cloud STT service:

```bash
cd stt-service
node index.js
```

5) Start NLP service:

```bash
cd nlp-service
npm start
```

6) Start automation service:

```bash
cd automation-service
npm start
```

7) Start frontend:

```bash
cd frontend
npm run dev
```

### Step 5: Open frontend at localhost:3000

```text
http://localhost:3000
```

---

## 10. HOW TO USE

1. Open the app at `http://localhost:3000`.
2. Select Google account (if multi-account is enabled in your deployment/profile; account selector component exists in frontend code).
3. Paste a Google Meet link.
4. Set meeting time (optional) for scheduled auto-join.
5. Bot joins automatically through automation service.
6. After meeting ends, the bot leaves and transcription starts.
7. Check Notion for summary page and Google Calendar for parsed deadlines.

Supported URL patterns in scheduler validation:

- `meet.google.com`
- `zoom.us` / `app.zoom.us`
- `teams.microsoft.com`

---

## 11. OUTPUT EXAMPLE

```json
{
  "cleaned_transcript": "We reviewed the onboarding backlog and agreed to close blockers this week. Product and design aligned on scope for the next release.",
  "summary": "The team aligned on release scope, reviewed dependencies, and confirmed owners for pending tasks. Risk items were tracked and deadlines were assigned for delivery readiness.",
  "action_items": [
  {
    "task": "Anita - finalize onboarding checklist",
    "responsible": "Anita",
    "deadline": "March 18, 2026"
  },
  {
    "task": "Rahul - confirm QA handoff",
    "responsible": "Rahul",
    "deadline": "March 20, 2026"
  }
  ],
  "llm_source": "groq",
  "summarization_method": "single_pass"
}
```

Notes about actual response fields in code:

- STT orchestrator response includes `source` values like `assemblyai`, `assemblyai+ollama`, or `local`.
- NLP summarizer adds `summarization_method` (`single_pass` or `map_reduce`).
- `llm_source` is a useful reporting field; if not present, infer from `source` + mode.

---

## 12. FEATURES LIST

- [x] Automatic Google Meet joining
- [x] System audio recording (no mic needed)
- [x] Dual STT pipeline with automatic fallback
- [x] Groq + Ollama summarization with fallback
- [x] Action item extraction with responsible person and deadline
- [x] Relative date parsing (e.g. "next Monday" → calendar event)
- [x] Automatic Notion page creation
- [x] Automatic Google Calendar event creation
- [x] Map-reduce summarization for long meetings
- [x] Cloud deployment ready (xvfb + PulseAudio headless)
- [ ] Speaker diarization (coming soon)
- [ ] Multi-platform support — Zoom, Teams (coming soon)

Implementation notes:

- Zoom and Teams adapters exist in `automation-service/src/platform`, but production-grade parity with Google Meet is still in progress.
- Calendar integration skips invalid/past deadlines by design.
- Integrations run in background and do not block STT/NLP responses.

---

## 13. PROJECT STRUCTURE

Source tree generated from real repo files (excluding `node_modules`, `__pycache__`, `venv`, and build artifacts):

```text
automated-meeting-assistant/
├── API-REFERENCE.md
├── ARCHITECTURE.md
├── CHANGES-SUMMARY.md
├── COMMANDS.md
├── NEW-FEATURES.md
├── README.md
├── SETUP.md
├── START-HERE.md
├── SYSTEM.md
├── TESTING.md
├── package.json
├── pytest.ini
├── requirements.txt
│
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── pipeline.py
│   ├── storage.py
│   ├── summarizer.py
│   └── transcriber.py
│
├── scripts/
│   └── run_offline_test.py
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_pipeline.py
│
├── local-stt-service/
│   └── app.py
│
├── automation-service/
│   ├── .env
│   ├── package.json
│   ├── sttClient.js
│   └── src/
│       ├── joinMeeting.js
│       ├── server.js
│       ├── platform/
│       │   ├── BaseAdapter.js
│       │   ├── GoogleMeetAdapter.js
│       │   ├── TeamsAdapter.js
│       │   ├── ZoomAdapter.js
│       │   ├── adapterFactory.js
│       │   ├── detectPlatform.js
│       │   └── index.js
│       └── utils/
│           ├── logger.js
│           └── recorder.js
│
├── stt-service/
│   ├── .env
│   ├── assemblyai.service.js
│   ├── index.js
│   ├── local.service.js
│   ├── orchestrator.js
│   ├── package.json
│   ├── retry.js
│   ├── routes.js
│   ├── stt.controller.js
│   └── stt.service.js
│
├── nlp-service/
│   ├── .env
│   ├── config.js
│   ├── index.js
│   ├── package.json
│   ├── summarizer.js
│   ├── routes/
│   │   ├── calendar.js
│   │   └── notion.js
│   └── services/
│       ├── calendarService.js
│       ├── notionService.js
│       └── retry.js
│
└── frontend/
  ├── README.md
  ├── package.json
  ├── vite.config.js
  └── src/
    ├── App.jsx
    ├── main.jsx
    ├── api/
    │   └── meeting.js
    ├── components/
    │   ├── AccountSelector.jsx
    │   ├── ActionItemsViewer.jsx
    │   ├── MeetingForm.jsx
    │   ├── NavBar.jsx
    │   ├── StartStopButtons.jsx
    │   ├── StatusDisplay.jsx
    │   ├── SummaryViewer.jsx
    │   └── TranscriptViewer.jsx
    └── pages/
      ├── MeetingDetails.jsx
      ├── MeetingsPage.jsx
      └── SchedulerForm.jsx
```

Command used to derive source files:

```bash
find . -type f \( -name "*.js" -o -name "*.py" \) \
  | grep -v node_modules \
  | grep -v __pycache__ \
  | grep -v '/venv/' \
  | grep -v '^./frontend/dist/'
```

---
