# Changelog — Automated Meeting Assistant

## v2.0 — Hybrid Pipeline & Integrations (March 2026)

### Hybrid STT Pipeline
- Added **AssemblyAI** as the primary transcription engine with automatic local fallback
- Implemented **AssemblyAI LeMUR** summarization (Anthropic Claude 3.5 Sonnet)
- Created `stt-service/orchestrator.js` — multi-level fallback strategy:
  - AssemblyAI → LeMUR → Ollama → Whisper (graceful degradation)
- Added `assemblyai.service.js` for cloud transcription + summarization
- Added `local.service.js` to bridge local Whisper + Ollama as fallback
- STT service now returns `source` field indicating which pipeline was used

### Notion Integration
- Added `@notionhq/client` integration in NLP service
- Created `notionService.js` — creates meeting pages with:
  - Page title: "Meeting - YYYY-MM-DD"
  - Summary heading + paragraph blocks
  - Tasks & Deadlines table (2-column: Task | Deadline)
- Date validation with ISO format conversion
- Text chunking for Notion's 2,000-character block limit
- Added `POST /notion` route for direct page creation

### Google Calendar Integration
- Added `googleapis` integration in NLP service
- Created `calendarService.js` — creates calendar events:
  - All-day events for date-only deadlines
  - 1-hour events for datetime deadlines
  - Automatic past-date filtering
- JWT authentication via Google service account
- Added `POST /calendar` route for direct event creation

### Integration Pipeline
- Added `POST /integrations/ingest` endpoint on NLP service
- Integrations trigger automatically after summarization (background, non-blocking)
- Both STT orchestrator and NLP `/summarize` endpoint push to integrations
- Integration failures never block the main pipeline

### NLP Service Enhancements
- Added `config.js` for centralized credential management
- Improved summarizer prompt — removed `important_dates` field
- Enhanced action item extraction with deadline linkage rules
- Added regex-based fallback for date and action item extraction
- Increased timeout to 300 seconds

### Frontend Updates
- Added `AccountSelector` component for multi-account support
- Added `ActionItemsViewer`, `SummaryViewer`, `TranscriptViewer` components
- Added `MeetingsPage` and `MeetingDetails` pages
- Added `NavBar` for navigation
- Configured Vite to serve on port 3000
- Using HashRouter for client-side routing

### Automation Service
- Enhanced `sttClient.js` to work with hybrid STT service
- Added retry logic (3 retries with delay)
- Added HTTP fallback when native fetch fails
- sttClient saves analysis results to `nlp-service/transcripts/`

### Documentation
- Complete rewrite of all markdown documentation for Linux
- Added `API-REFERENCE.md` with full request/response schemas
- Added `ARCHITECTURE.md` with detailed service interaction diagrams
- Updated `SYSTEM.md` with current architecture and features

---

## v1.0 — Core Meeting Automation (January 2026)

### Meeting Automation
- Playwright-based browser automation for Google Meet
- Brave Browser with persistent user profile support
- Automatic camera/mic disable (multiple detection strategies)
- Keyboard shortcut backup (Ctrl+D for mic, Ctrl+E for camera)
- Meeting end detection (page close, URL change, DOM text)
- "Ask to join" button auto-click with multiple selectors

### Audio Recording
- ffmpeg recording from PulseAudio monitor source
- Whisper-optimized format: 16 kHz, mono, PCM 16-bit WAV
- Graceful recording stop via SIGINT on meeting end

### Local STT Service
- FastAPI server running OpenAI Whisper
- Model fallback (small → base on OOM)
- Auto-detect CPU/CUDA device
- Concurrency control via semaphore
- Audio preprocessing to Whisper-compatible format

### Local NLP Service
- Ollama integration for LLM summarization
- Structured JSON output: cleaned_transcript, summary, action_items
- Transcript preprocessing (whitespace, duplicates, punctuation)

### Frontend
- React 18 + Vite web UI
- Meeting join with instant or scheduled mode
- Live countdown timer for scheduled meetings

### Offline Pipeline
- Python CLI for processing pre-recorded audio
- Configurable Whisper model, device, Ollama model
- JSON output to `output/` directory

### Testing
- Pytest suite for Python offline pipeline
- Tests for transcriber, summarizer, storage, and full pipeline
