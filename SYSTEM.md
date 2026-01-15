1. Project Objective

Design and deploy a server-based Automated Meeting Assistant capable of autonomously participating in online meetings, capturing audio, transcribing conversations, and generating structured summaries and action items using AI.

The system must operate without reliance on any user’s local machine.

2. Target Platforms

Phase 1: Google Meet

Phase 2 (Optional): Zoom

3. Core Features
3.1 Meeting Automation

Automatically join scheduled meetings

Support multiple Google accounts for authentication

Handle meeting permissions and waiting rooms where applicable

3.2 Audio Processing

Capture meeting audio reliably on the server

Support multi-speaker conversations

3.3 Speech-to-Text

Convert captured audio into accurate text transcripts

Timestamped and speaker-aware transcription (where possible)

3.4 AI Intelligence

Generate concise meeting summaries

Extract clear action items and decisions

Highlight key discussion points

3.5 Web Dashboard

View meeting history

Access transcripts, summaries, and action items

Manage connected accounts and meetings

4. Non-Goals (Explicitly Out of Scope)

Manual meeting recording

Mobile application support (initial phase)

Any dependency on a user’s local computer or browser

5. Deployment Requirements

Runs entirely on a server

Headless operation (no GUI dependency)

Designed for scalability and automation

6. AI Agent Safety & Project Integrity Rules (MANDATORY)

⚠️ CRITICAL RULES FOR ALL AI AGENTS WORKING ON THIS PROJECT

Never delete, overwrite, or reset the entire project content

This includes source code, configuration files, documentation, or repository structure

Explicit user confirmation is required before any destructive operation

Incremental Changes Only

Modify files surgically and intentionally

Preserve existing logic unless instructed otherwise

Ask Before Major Refactors

Any large architectural change must be proposed first

Execution only after explicit approval

Project Continuity is Mandatory

The assistant must assume this project is long-lived and production-oriented

No “start from scratch” behavior unless explicitly requested

ALWAYS CONNECT ALL THE MODULES THROUGH APPROPRIATE API ONLY

✔ Each module should have:
Its own config
Its own dependencies
Its own logs