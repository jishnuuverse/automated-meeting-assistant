# System Specification — Automated Meeting Assistant

## 1. Project Objective

Design and deploy a server-based Automated Meeting Assistant capable of autonomously participating in online meetings, capturing audio, transcribing conversations, and generating structured summaries and action items using AI.

The system operates with a **hybrid cloud + local** architecture — leveraging AssemblyAI for transcription and summarization when available, with full local fallback using OpenAI Whisper and Ollama.

## 2. Target Platforms

- **Phase 1:** Google Meet ✅ (Implemented)
- **Phase 2 (Optional):** Zoom

## 3. Core Features

### 3.1 Meeting Automation
- Automatically join scheduled Google Meet meetings
- Support multiple Google accounts for authentication
- Handle meeting permissions and waiting rooms
- Auto-disable camera and microphone before joining
- Detect meeting end and trigger post-processing

### 3.2 Audio Processing
- Capture system audio via PulseAudio monitor source
- Record in Whisper-optimized format (16 kHz, mono, PCM 16-bit WAV)
- No dependency on microphone — captures what the system hears

### 3.3 Speech-to-Text (Hybrid Pipeline)
- **Primary:** AssemblyAI cloud transcription (Universal-2 model)
- **Fallback:** Local OpenAI Whisper (small model by default)
- Automatic fallback on API key absence, credit exhaustion, or errors
- Configurable model sizes and devices (CPU/CUDA)

### 3.4 AI Intelligence (Hybrid Pipeline)
- **Primary:** AssemblyAI LeMUR (Anthropic Claude 3.5 Sonnet)
- **Fallback:** Local Ollama (phi or mistral models)
- Generate concise, comprehensive meeting summaries
- Extract action items with responsible persons and deadlines
- Clean and correct transcript grammar/punctuation

### 3.5 Integrations
- **Notion:** Create meeting pages with summary text + tasks/deadlines table
- **Google Calendar:** Create calendar events for upcoming action item deadlines
- Integrations run in the background — failures are logged but never block the pipeline

### 3.6 Web Dashboard
- View meeting history
- Access transcripts, summaries, and action items
- Join meetings instantly or schedule for later
- Select Google account for authentication
- Live countdown for scheduled meetings

### 3.7 Offline Pipeline
- CLI tool for processing pre-recorded audio files
- Independent of the web service stack
- Configurable Whisper model, Ollama model, and output settings

## 4. Non-Goals (Explicitly Out of Scope)

- Manual meeting recording
- Mobile application support (initial phase)
- Real-time live transcription during the meeting (post-meeting processing only)
- Video recording or screen capture

## 5. Service Architecture

| Service | Port | Technology | Purpose |
|---|---|---|---|
| Frontend | 3000 | React + Vite | Web UI |
| Automation Service | 4001 | Node.js + Express + Playwright | Browser automation + recording |
| Hybrid STT Service | 5002 | Node.js + Express | AssemblyAI + local fallback orchestration |
| Local STT Service | 6000 | Python + FastAPI + Whisper | Local speech-to-text |
| NLP Service | 7000 | Node.js + Express + Ollama | Summarization + Notion/Calendar integrations |
| Ollama | 11434 | Go | Local LLM inference engine |

## 6. Deployment Requirements

- Runs on Linux (Ubuntu 20.04+)
- Headless operation supported (via xvfb)
- Each service runs independently with its own config, dependencies, and logs
- Designed for single-server deployment with potential for scaling

## 7. AI Agent Safety & Project Integrity Rules (MANDATORY)

> **⚠️ CRITICAL RULES FOR ALL AI AGENTS WORKING ON THIS PROJECT**

1. **Never delete, overwrite, or reset the entire project content.** This includes source code, configuration files, documentation, or repository structure. Explicit user confirmation is required before any destructive operation.

2. **Incremental Changes Only.** Modify files surgically and intentionally. Preserve existing logic unless instructed otherwise.

3. **Ask Before Major Refactors.** Any large architectural change must be proposed first. Execution only after explicit approval.

4. **Project Continuity is Mandatory.** The assistant must assume this project is long-lived and production-oriented. No "start from scratch" behavior unless explicitly requested.

5. **Always connect all modules through appropriate APIs only.** Each module should have its own config, dependencies, and logs.
