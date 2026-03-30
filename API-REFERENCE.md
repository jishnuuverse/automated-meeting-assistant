# API Reference — Automated Meeting Assistant

Complete request/response documentation for all service endpoints.

---

## Automation Service (`:4001`)

### `GET /`

Service status.

**Response:**
```json
{
  "status": "running",
  "service": "automation-service",
  "timestamp": "2026-03-01T10:00:00.000Z"
}
```

### `GET /health`

Health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-01T10:00:00.000Z"
}
```

### `POST /api/meetings`

Join a Google Meet session.

**Request:**
```json
{
  "url": "https://meet.google.com/abc-defg-hij",
  "braveExecutable": "/usr/bin/brave-browser",
  "userDataDir": "/home/user/.config/BraveSoftware/Brave-Browser/Default"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Google Meet URL |
| `braveExecutable` | string | Yes | Path to Brave browser binary |
| `userDataDir` | string | Yes | Path to Brave user profile directory |

**Response (`202 Accepted`):**
```json
{
  "started": true,
  "pid": 12345,
  "log": "logs/join-1772357941068-12345.log"
}
```

**Error Responses:**

| Status | Cause |
|---|---|
| `400` | Missing `url`, `userDataDir`, or `braveExecutable` |

---

## Hybrid STT Service (`:5002`)

### `GET /`

Service info with AssemblyAI configuration status.

**Response:**
```json
{
  "success": true,
  "service": "stt-service (hybrid)",
  "assemblyai": true
}
```

### `POST /api/stt/transcribe` | `POST /api/stt/process`

Hybrid transcription + summarization. Tries AssemblyAI first, falls back to local Whisper + Ollama.

**Request:**
```json
{
  "meetingId": "meeting-1772357941068",
  "audioFilePath": "/home/user/automated-meeting-assistant/logs/recordings/meeting-2026-03-01.wav"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `meetingId` | string | Yes | Unique meeting identifier |
| `audioFilePath` | string | Yes | Absolute path to audio file |

**Response (`200 OK`):**
```json
{
  "success": true,
  "source": "assemblyai",
  "transcript": "Hello everyone, welcome to the meeting...",
  "summary": {
    "cleaned_transcript": "Hello everyone, welcome to the meeting...",
    "summary": "The team discussed Q1 goals and assigned action items...",
    "action_items": [
      {
        "task": "Prepare budget report",
        "responsible": "John",
        "deadline": "March 10, 2026"
      }
    ]
  }
}
```

| Response Field | Description |
|---|---|
| `source` | Pipeline used: `"assemblyai"`, `"assemblyai+ollama"`, or `"local"` |
| `transcript` | Raw transcript text |
| `summary` | Structured analysis (may be `null` if both summarizers fail) |
| `fallbackReason` | Reason for fallback (present only if fallback occurred) |
| `summaryError` | Error details if summary failed (present only on failure) |

**Error Response (`502 Bad Gateway`):**
```json
{
  "success": false,
  "source": "none",
  "transcript": "",
  "summary": null,
  "error": "Both pipelines failed. AssemblyAI: ... | Local: ..."
}
```

---

## Local STT Service (`:6000`)

### `POST /transcribe`

Transcribe audio using local Whisper model.

**Request:**
```json
{
  "meetingId": "meeting-1772357941068",
  "audioFilePath": "/absolute/path/to/recording.wav"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `meetingId` | string | Yes | Meeting identifier (min 1 char) |
| `audioFilePath` | string | Yes | Absolute path to audio file (min 1 char) |

**Response (`200 OK`):**
```json
{
  "success": true,
  "transcript": "Hello everyone, welcome to today's meeting..."
}
```

**Error Responses:**

| Status | Cause |
|---|---|
| `404` | Audio file not found at specified path |
| `413` | Audio file exceeds the 200 MB size limit |
| `422` | Invalid request parameters |
| `500` | Internal transcription error |

---

## NLP Service (`:7000`)

### `GET /`

Service health check.

**Response:**
```json
{
  "success": true,
  "service": "nlp-service"
}
```

### `POST /summarize`

Summarize a transcript using Ollama LLM. Also triggers background push to Notion + Google Calendar.

**Request:**
```json
{
  "transcript": "Full meeting transcript text..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `transcript` | string | Yes | Non-empty transcript text (min ~50 chars) |

**Response (`200 OK`):**
```json
{
  "success": true,
  "result": {
    "cleaned_transcript": "Cleaned version of the transcript...",
    "summary": "The team discussed Q4 goals and agreed on...",
    "action_items": [
      {
        "task": "Prepare the budget report",
        "responsible": "Alice",
        "deadline": "March 10"
      }
    ]
  }
}
```

**Error Responses:**

| Status | Cause |
|---|---|
| `400` | Missing or empty transcript |
| `500` | Summarization failed |

### `POST /integrations/ingest`

Accept a pre-built summary result and trigger Notion + Calendar push. Used by the hybrid STT orchestrator.

**Request:**
```json
{
  "summary": "Meeting summary text...",
  "action_items": [
    {
      "task": "Review budget",
      "responsible": "John",
      "deadline": "2026-03-10"
    }
  ],
  "meeting_date": "2026-03-01"
}
```

**Response (`200 OK`):**
```json
{
  "success": true
}
```

### `POST /notion`

Create a meeting page in Notion directly.

**Request:**
```json
{
  "meeting_date": "2026-03-01",
  "summary": "Meeting summary text...",
  "action_items": [
    {
      "task": "Review budget",
      "deadline": "2026-03-10"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `meeting_date` | string | Yes | Date in ISO format (YYYY-MM-DD) or parseable format |
| `summary` | string | Yes | Non-empty summary text |
| `action_items` | array | No | Array of `{task, deadline}` objects |

**Response (`200 OK`):**
```json
{
  "success": true,
  "pageId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "url": "https://www.notion.so/..."
}
```

**Error Responses:**

| Status | Cause |
|---|---|
| `400` | Missing `meeting_date` or empty `summary` |
| `422` | Notion API error (e.g., invalid database, permissions) |
| `500` | Internal server error |

### `POST /calendar`

Create Google Calendar events for action items.

**Request:**
```json
{
  "action_items": [
    {
      "calendar_event_title": "Review budget deadline",
      "calendar_event_date": "2026-03-10"
    },
    {
      "calendar_event_title": "Team sync",
      "calendar_event_date": "2026-03-05T14:00:00"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action_items` | array | Yes | Array of event objects |
| `action_items[].calendar_event_title` | string | No | Event title (default: "Meeting action item") |
| `action_items[].calendar_event_date` | string | Yes | Date or datetime for the event |

**Date formatting:**
- Date-only (`"2026-03-10"`) → Creates an **all-day event**
- Datetime (`"2026-03-10T14:00:00"`) → Creates a **1-hour event**
- Past dates are **skipped** automatically

**Response (`200 OK`):**
```json
{
  "success": true,
  "results": [
    {
      "success": true,
      "event": {
        "id": "...",
        "htmlLink": "https://calendar.google.com/..."
      }
    }
  ]
}
```

---

## Common Error Patterns

### Validation Error

```json
{
  "success": false,
  "error": "Description of what's missing or invalid"
}
```

### Service Unavailable

```json
{
  "success": false,
  "error": "Connection refused or service not running"
}
```

### Integration Failure

Integrations (Notion, Calendar) run in the background and never block the main pipeline. Failures are logged to the console but don't affect the transcription/summarization response.
