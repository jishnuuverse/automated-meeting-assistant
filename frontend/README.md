# Automated Meeting Assistant — Frontend

Minimal React frontend (Vite) for the Automated Meeting Assistant.

Features implemented:
- Meeting link input
- Google account selector UI (placeholder)
- Start / Stop buttons
- Live status display (polls `/api/meeting/status`)
- Transcript viewer
- AI summary viewer
- Action items viewer

API expectations (backend must implement):
- POST `/api/meeting/start` (body: { meeting_link, account })
- POST `/api/meeting/stop`
- GET  `/api/meeting/status` -> { status }
- GET  `/api/meeting/transcript` -> { lines: [{speaker, text, time}] }
- GET  `/api/meeting/summary` -> { summary, action_items }

Quick start

1. Install dependencies

```bash
cd frontend
npm install
```

2. Run dev server

```bash
npm run dev
```

New pages

- `Schedule Meeting` (home): enter your email, meeting time, and Google Meet link, then press `Done`.
- `Scheduled Meetings`: view scheduled meetings, open the Meet, view details, or delete.
- `Meeting Details`: fetch transcript and AI summary from the backend and view action items.

Notes
- Meetings are temporarily stored in the browser's `localStorage` under `scheduled_meetings`.
- The frontend expects the backend endpoints listed below to be available for fetching transcripts and summaries.

Notes
- This frontend is intentionally client-only. It does not implement browser automation, STT, or AI logic — those live in backend services.
- Authentication is expected to be handled by the backend; the `AccountSelector` is a UI placeholder. You can wire `/api/auth/google` or a similar flow in the backend.
