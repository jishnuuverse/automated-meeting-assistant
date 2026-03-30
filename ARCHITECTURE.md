# Architecture & Integrations — Automated Meeting Assistant

Detailed technical architecture, service interactions, and integration design.

---

## Service Map

```
┌─────────────┐     ┌─────────────────┐     ┌───────────────┐
│  Frontend    │────▶│  Automation      │────▶│  PulseAudio   │
│  React :3000 │     │  Service :4001   │     │  + ffmpeg      │
└─────────────┘     └────────┬──────────┘     └───────┬───────┘
                             │                        │
                             │ sttClient.js            │ .wav
                             ▼                        ▼
                    ┌─────────────────┐     ┌───────────────┐
                    │  Hybrid STT     │     │  logs/        │
                    │  Service :5002  │     │  recordings/  │
                    └────────┬──────────┘     └───────────────┘
                             │
                    ┌────────┴──────────┐
                    │                   │
              ┌─────▼──────┐    ┌──────▼───────┐
              │ AssemblyAI │    │  Local STT   │
              │ Cloud API  │    │  Whisper     │
              │            │    │  :6000       │
              └─────┬──────┘    └──────┬───────┘
                    │                  │
              ┌─────▼──────┐    ┌──────▼───────┐
              │ LeMUR      │    │  Ollama      │
              │ Claude 3.5 │    │  phi/mistral │
              │ Sonnet     │    │  :11434      │
              └─────┬──────┘    └──────┬───────┘
                    │                  │
                    └────────┬─────────┘
                             │
                    ┌────────▼──────────┐
                    │  NLP Service      │
                    │  :7000            │
                    └────────┬──────────┘
                             │
                    ┌────────┴──────────┐
                    │                   │
              ┌─────▼──────┐    ┌──────▼───────┐
              │  Notion    │    │  Google      │
              │  API       │    │  Calendar    │
              └────────────┘    └──────────────┘
```

---

## Services in Detail

### 1. Frontend (`:3000`)

**Technology:** React 18 + Vite + React Router (HashRouter)

**Routes:**
| Route | Component | Purpose |
|---|---|---|
| `/` | `SchedulerForm` | Join/schedule meetings |
| `/meetings` | `MeetingsPage` | List past meetings |
| `/meeting/:id` | `MeetingDetails` | View transcript + summary |

**Key Components:**
- `AccountSelector` — Dropdown for Google account selection
- `MeetingForm` — Meeting link input
- `StartStopButtons` — Join/leave controls
- `StatusDisplay` — Real-time meeting state
- `TranscriptViewer` / `SummaryViewer` / `ActionItemsViewer` — Result display

**API Communication:** Calls `POST /api/meetings` on the automation service via `api/meeting.js`.

---

### 2. Automation Service (`:4001`)

**Technology:** Node.js + Express + Playwright

**Responsibilities:**
- Accept meeting join requests via REST API
- Launch Brave browser with user's persistent profile
- Navigate to Google Meet, disable camera/mic, click "Join"
- Start ffmpeg recording (PulseAudio monitor → WAV)
- Monitor for meeting end (page close, navigation away, "left the meeting" text)
- Stop recording on meeting end (SIGINT to ffmpeg)
- Trigger hybrid STT pipeline via `sttClient.js`

**Audio Recording:**
```
ffmpeg -f pulse -i <monitor_source> -ac 1 -ar 16000 -c:a pcm_s16le output.wav
```
- Mono, 16 kHz, PCM 16-bit — optimized for Whisper
- Output: `logs/recordings/meeting-<timestamp>.wav`

**sttClient.js Flow:**
1. Calls hybrid STT service (`POST /api/stt/process`)
2. If hybrid service returns summary → saves to `nlp-service/transcripts/`
3. If hybrid service returns transcript without summary → calls NLP service separately
4. Retries up to 3 times on transient failures
5. HTTP fallback (direct `http` module) if native `fetch` fails

---

### 3. Hybrid STT Service (`:5002`)

**Technology:** Node.js + Express + AssemblyAI SDK

**Purpose:** Orchestrate transcription and summarization with multi-level fallback.

**Orchestration Strategy:**

```
processMeeting(audioFilePath, meetingId)
│
├── 1. Try AssemblyAI transcription
│   ├── Success: Got transcript
│   │   ├── 2. Try AssemblyAI LeMUR summarization
│   │   │   ├── Success → Return { source: "assemblyai" }
│   │   │   └── Failure → 3. Use Ollama summarization
│   │   │       ├── Success → Return { source: "assemblyai+ollama" }
│   │   │       └── Failure → Return transcript only (no summary)
│   │   └──
│   └── Failure → 4. Full local fallback
│       ├── Whisper transcription (via local-stt-service :6000)
│       ├── Ollama summarization (via nlp-service/summarizer.js)
│       ├── Success → Return { source: "local" }
│       └── Failure → Return error
│
└── After any successful summary:
    └── Push to NLP integrations (Notion + Calendar) in background
```

**Key Files:**
- `orchestrator.js` — Main pipeline logic
- `assemblyai.service.js` — AssemblyAI transcription + LeMUR summarization
- `local.service.js` — Local Whisper + Ollama fallback
- `stt.controller.js` — Express request handler

**AssemblyAI Configuration:**
- Speech model: `universal-2`
- LeMUR model: `anthropic/claude-3-5-sonnet`
- Timeout: 10 minutes (configurable)

---

### 4. Local STT Service (`:6000`)

**Technology:** Python + FastAPI + OpenAI Whisper + PyTorch

**Responsibilities:**
- Load Whisper model at startup (with fallback from `small` to `base` on OOM)
- Accept audio file paths via POST
- Preprocess audio to Whisper-compatible format (16 kHz mono PCM)
- Transcribe using Whisper
- Save transcript text to `transcripts/` directory
- Concurrency control via semaphore

**Model Loading:**
```python
# Attempt preferred model, fallback on failure
try:
    model = whisper.load_model("small", device=device)
except:
    model = whisper.load_model("base", device=device)
```

**Transcription Settings:**
```python
model.transcribe(audio_path, language="en", fp16=False, temperature=0)
```

---

### 5. NLP Service (`:7000`)

**Technology:** Node.js + Express + Ollama + Notion API + Google Calendar API

**Responsibilities:**
- Summarize transcripts using local Ollama LLM
- Push summaries to Notion (meeting pages)
- Push action item deadlines to Google Calendar
- Accept integration pushes from the hybrid STT orchestrator

**Routes:**
| Endpoint | Purpose |
|---|---|
| `POST /summarize` | Ollama summarization + background integration push |
| `POST /integrations/ingest` | Accept pre-built summary → Notion + Calendar |
| `POST /notion` | Direct Notion page creation |
| `POST /calendar` | Direct Calendar event creation |

**Summarization Flow:**
1. Preprocess transcript (normalize whitespace, remove duplicate words, fix punctuation)
2. Build prompt with extraction rules for cleaned_transcript, summary, action_items
3. Send to Ollama (`phi` model, JSON mode, 300s timeout)
4. Parse JSON response (handle markdown fences, extract nested JSON)
5. Regex-based fallback for dates and action items if LLM response is incomplete
6. Background push to Notion + Calendar

---

## Integration Architecture

### Notion Integration

**Library:** `@notionhq/client` v5.11+

**Page Structure:**
```
┌───────────────────────────────┐
│ 📄 Meeting - 2026-03-01      │ ← Page title
├───────────────────────────────┤
│ Meeting Date: 2026-03-01     │ ← Date property
├───────────────────────────────┤
│ ## Summary                    │
│ The team discussed...         │ ← Paragraph blocks (chunked to 2000 chars)
├───────────────────────────────┤
│ ────────────────────────────  │ ← Divider
├───────────────────────────────┤
│ ## Tasks & Deadlines          │
│ ┌──────────────┬────────────┐ │
│ │ Task (bold)  │ Deadline   │ │ ← Table header
│ ├──────────────┼────────────┤ │
│ │ Fix bugs     │ March 10   │ │ ← Data rows
│ │ Review docs  │ March 15   │ │
│ └──────────────┴────────────┘ │
└───────────────────────────────┘
```

**Date Validation:**
- Parses ISO dates, MM/DD/YYYY, DD-MM-YYYY formats
- Rejects dates with unrealistic years (< current year - 1)

**Text Handling:**
- Notion rich_text content blocks are capped at 2,000 characters
- Long summaries are automatically chunked into multiple paragraph blocks

### Google Calendar Integration

**Library:** `googleapis` (Google Calendar v3 API)

**Authentication:** Service account JWT (no OAuth consent screen needed)

**Event Types:**
| Input | Event Type | Duration |
|---|---|---|
| `"2026-03-10"` (date only) | All-day event | 1 day |
| `"2026-03-10T14:00:00"` (datetime) | Timed event | 1 hour |

**Rules:**
- Only upcoming dates are added (today or future)
- Past dates are silently skipped
- Invalid/unparseable dates logged and skipped
- Calendar must be shared with service account email

### Integration Trigger Points

Integrations are triggered at two points:

1. **After NLP summarization** (`POST /summarize`):
   - `pushToIntegrations()` runs in background
   - Creates Notion page + Calendar events from summary result

2. **After hybrid STT orchestration** (via `POST /integrations/ingest`):
   - STT orchestrator pushes completed summary to NLP service
   - Same `pushToIntegrations()` runs in background
   - Ensures integrations fire regardless of which pipeline produced the summary

**Non-blocking design:** Integration failures are logged but never cause the main response to fail or delay.

---

## Data Flow Summary

```
User → Frontend (:3000)
  → POST /api/meetings → Automation Service (:4001)
    → Playwright + Brave → Google Meet
    → ffmpeg → PulseAudio → .wav file
    → Meeting ends → sttClient.js
      → POST /api/stt/process → Hybrid STT (:5002)
        → AssemblyAI OR Local Whisper (:6000) → Transcript
        → LeMUR OR Ollama (:11434) → Summary
        → POST /integrations/ingest → NLP Service (:7000)
          → Notion API → Meeting page
          → Calendar API → Deadline events
      → Save → nlp-service/transcripts/meeting_<id>.json
  → User views results in frontend
```

---

## File Output Locations

| What | Where | Format |
|---|---|---|
| Raw audio recordings | `logs/recordings/` | `.wav` (16kHz, mono, PCM) |
| Meeting join logs | `logs/` | `.log` (text) |
| Transcript text | `local-stt-service/transcripts/` | `.txt` |
| NLP analysis results | `nlp-service/transcripts/` | `.json` |
| Offline pipeline output | `output/` | `.json` |
| Request logs | `logs/requests.log` | Text (append) |
