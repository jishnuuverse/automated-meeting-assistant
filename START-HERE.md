# 🎯 Quick Start — Read This First!

## 3 Steps to Get Running

### 1️⃣ Install Dependencies

```bash
# Node.js services
cd automation-service && npm install && npx playwright install chromium && cd ..
cd stt-service && npm install && cd ..
cd nlp-service && npm install && cd ..
cd frontend && npm install && cd ..

# Python (local STT)
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# Ollama model
ollama pull phi
```

### 2️⃣ Start Services (6 terminals)

```bash
ollama serve                                                                    # T1
cd local-stt-service && source ../venv/bin/activate && uvicorn app:app --host 0.0.0.0 --port 6000  # T2
cd stt-service && node index.js                                                 # T3
cd nlp-service && node index.js                                                 # T4
cd automation-service && node src/server.js                                     # T5
cd frontend && npm run dev                                                      # T6
```

### 3️⃣ Use It!

Open **http://localhost:3000** → Paste a Google Meet link → Click **"Join Now"**

That's it! The system will join the meeting, record audio, transcribe, summarize, and push results to Notion/Calendar (if configured).

---

## 📋 What Each Service Does

| Port | Service | What It Does |
|---|---|---|
| 11434 | Ollama | Local LLM for summarization fallback |
| 6000 | Local STT | Whisper speech-to-text (fallback) |
| 5002 | Hybrid STT | AssemblyAI transcription with local fallback |
| 7000 | NLP | Summarization + Notion/Calendar integrations |
| 4001 | Automation | Browser automation + audio recording |
| 3000 | Frontend | Web UI for managing meetings |

---

## 🔧 Optional: Configure Integrations

For Notion and Google Calendar integration, create `nlp-service/.env`:

```env
NOTION_API_KEY=your_key
NOTION_DATABASE_ID=your_db_id
GOOGLE_CLIENT_EMAIL=your_service_account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=your_calendar_id
```

For cloud STT (AssemblyAI), create `stt-service/.env`:

```env
ASSEMBLYAI_API_KEY=your_key
```

Without these, the system works fully locally with Whisper + Ollama.

---

## 📚 Need More Help?

| Document | What's In It |
|---|---|
| [SETUP.md](SETUP.md) | Detailed installation & configuration |
| [COMMANDS.md](COMMANDS.md) | All commands in one place |
| [TESTING.md](TESTING.md) | How to test everything |
| [API-REFERENCE.md](API-REFERENCE.md) | API endpoint documentation |
| [README.md](README.md) | Full project overview |

---

## 🐛 Something Not Working?

```bash
# Check which services are running
ss -tlnp | grep -E '3000|4001|5002|6000|7000|11434'

# Check logs
ls -t logs/join-*.log 2>/dev/null | head -1 | xargs cat

# Kill a port
lsof -ti:PORT | xargs kill -9
```
