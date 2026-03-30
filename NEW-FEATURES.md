# New Features — v2.0

A summary of the major new capabilities added to the Automated Meeting Assistant.

---

## 1. Hybrid STT Pipeline

The system now uses a **multi-level fallback** strategy for transcription and summarization, managed by the STT orchestrator (`stt-service/orchestrator.js`):

| Level | Service | What It Does |
|-------|---------|-------------|
| 1 | AssemblyAI | Cloud transcription + LeMUR summarization (Claude 3.5 Sonnet) |
| 2 | Ollama | Local LLM summarization (if LeMUR fails) |
| 3 | Whisper | Local transcription (if AssemblyAI fails entirely) |

The response always includes a `source` field so you know which pipeline produced the results.

---

## 2. Notion Integration

After a meeting is summarized, the system automatically creates a **Notion page** containing:

- **Page title:** "Meeting - YYYY-MM-DD"
- **Summary section:** Full meeting summary as paragraph blocks
- **Tasks & Deadlines table:** A database-style table with Task and Deadline columns

### Configuration
Set these in `nlp-service/.env`:
```
NOTION_API_KEY=secret_...
NOTION_PARENT_PAGE_ID=...
```

### Manual trigger
```bash
curl -X POST http://localhost:7000/notion \
  -H "Content-Type: application/json" \
  -d '{"summary": "...", "action_items": [...]}'
```

---

## 3. Google Calendar Integration

Deadlines extracted from meetings are automatically created as **Google Calendar events**:

- **Date-only deadlines** → all-day events
- **Datetime deadlines** → 1-hour timed events
- **Past dates** are automatically filtered out

### Configuration
Set these in `nlp-service/.env`:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GOOGLE_CALENDAR_ID=...@group.calendar.google.com
```

### Manual trigger
```bash
curl -X POST http://localhost:7000/calendar \
  -H "Content-Type: application/json" \
  -d '{"action_items": [{"task": "Submit report", "deadline": "2026-03-15"}]}'
```

---

## 4. Unified Integration Endpoint

A single endpoint triggers both Notion and Calendar integrations:

```bash
curl -X POST http://localhost:7000/integrations/ingest \
  -H "Content-Type: application/json" \
  -d '{"summary": "...", "action_items": [...]}'
```

This endpoint runs both integrations in background (non-blocking). Failures in either integration do not affect the other or the main pipeline.

---

## 5. Enhanced NLP Summarization

- Improved Ollama prompt for better action item extraction
- Deadline linkage — each action item can have an associated deadline
- Regex-based fallback parsing when LLM JSON output is malformed
- Removed deprecated `important_dates` field from output schema

**Current output schema:**
```json
{
  "cleaned_transcript": "...",
  "summary": "...",
  "action_items": [
    { "task": "...", "deadline": "YYYY-MM-DD" }
  ]
}
```

---

## 6. Frontend Improvements

- **Account Selector** — switch between multiple Google accounts / Brave profiles
- **Dedicated viewers** — separate panels for transcript, summary, and action items
- **Navigation** — NavBar with page-level routing (HashRouter)
- **Meeting management** — MeetingsPage lists past meetings, MeetingDetails shows full results

---

## 7. Multi-Account / Profile Support

The automation service now supports running meetings under different Brave Browser user profiles. The account selector in the frontend lets you pick the profile before joining a meeting.

---

## Service Architecture

```
Frontend (:3000)
    │
    ▼
Automation Service (:4001) ──► STT Service (:5002) ──► NLP Service (:7000)
                                    │                        │
                              ┌─────┴──────┐          ┌─────┴──────┐
                              │ AssemblyAI  │          │   Notion   │
                              │ (cloud)     │          │  Calendar  │
                              └─────┬──────┘          └────────────┘
                              │ Whisper     │
                              │ (:6000)     │
                              └─────┬──────┘
                              │ Ollama      │
                              │ (:11434)    │
                              └─────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical details.
