'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { detectPlatform, isSupportedPlatform } = require('./platform/detectPlatform');
const { createLogger } = require('./utils/logger');

const log = createLogger('Server');
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

/* ------------------------------------------------------------------ */
/*  Session guard: prevent duplicate meeting sessions                   */
/* ------------------------------------------------------------------ */
let isSessionActive = false;
let activeSessionPid = null;
const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');

/* ------------------------------------------------------------------ */
/*  Helper: persist incoming requests to disk                          */
/* ------------------------------------------------------------------ */
function persistRequestLog(body) {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const reqLog = path.join(LOGS_DIR, 'requests.log');
    fs.appendFileSync(reqLog, `${new Date().toISOString()} ${JSON.stringify(body)}\n`);
  } catch (e) {
    log.error('Failed to write request log', { error: e.message });
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: platform-specific request validation                       */
/* ------------------------------------------------------------------ */
function validateRequest(body) {
  const { url, userDataDir, braveExecutable } = body || {};

  if (!url) return 'Missing url';
  if (!isSupportedPlatform(url)) {
    return `Unsupported meeting URL. Supported platforms: Google Meet, Zoom, Microsoft Teams.`;
  }

  const platform = detectPlatform(url);

  // Google Meet requires Playwright/Brave paths
  if (platform === 'google') {
    if (!userDataDir) return 'Missing userDataDir (required for Google Meet)';
    if (!braveExecutable) return 'Missing braveExecutable (required for Google Meet)';
  }

  // Zoom also requires Playwright/Brave paths for browser automation
  if (platform === 'zoom') {
    if (!userDataDir) return 'Missing userDataDir (required for Zoom)';
    if (!braveExecutable) return 'Missing braveExecutable (required for Zoom)';
  }

  return null; // valid
}

/* ------------------------------------------------------------------ */
/*  POST /api/meetings — multi-platform entry point                    */
/* ------------------------------------------------------------------ */
app.post('/api/meetings', (req, res) => {
  log.info('Received meeting request');
  persistRequestLog(req.body);

  // ── Session guard: reject if a meeting is already active ──
  if (isSessionActive) {
    log.warn('Rejected: a meeting session is already active', { pid: activeSessionPid });
    return res.status(409).json({ error: 'A meeting session is already active' });
  }

  const validationError = validateRequest(req.body);
  if (validationError) {
    log.warn('Validation failed', { reason: validationError });
    return res.status(400).json({ error: validationError });
  }

  const { url, userDataDir, braveExecutable, processing_mode } = req.body;
  const platform = detectPlatform(url);
  log.info('Platform detected', { platform, url, processing_mode: processing_mode || 'cloud' });

  // Build argument list for the joinMeeting orchestrator
  const scriptPath = path.join(__dirname, 'joinMeeting.js');
  const args = [scriptPath, url];

  // Google Meet and Zoom need browser paths; Teams relies on env-based API keys only
  if (platform === 'google' || platform === 'zoom') {
    args.push(braveExecutable, userDataDir);
  }

  log.info('Spawning joinMeeting process', { platform, script: scriptPath });

  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

    // Google Meet and Zoom use xvfb-run for headless display; API adapters don't need it.
    const useXvfb = (platform === 'google' || platform === 'zoom');
    const spawnCmd = useXvfb ? 'xvfb-run' : process.execPath;
    const spawnArgs = useXvfb
      ? ['-a', process.execPath, ...args]
      : args;

    const child = spawn(spawnCmd, spawnArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PROCESSING_MODE: processing_mode || 'cloud' },
    });

    const ts = Date.now();
    const logPath = path.join(LOGS_DIR, `join-${platform}-${ts}-${child.pid}.log`);
    const outStream = fs.createWriteStream(logPath, { flags: 'a' });

    outStream.write(
      `=== spawn ${new Date().toISOString()} pid=${child.pid} platform=${platform} ===\n`
    );

    if (child.stdout) child.stdout.pipe(outStream);
    if (child.stderr) child.stderr.pipe(outStream);

    // ── Mark session as active ──
    isSessionActive = true;
    activeSessionPid = child.pid;
    log.info('Session marked active', { pid: child.pid });

    child.on('exit', (code, signal) => {
      log.info(`Process ${child.pid} exited`, { code, signal, platform });
      outStream.write(
        `=== exit code=${code} signal=${signal} at ${new Date().toISOString()} ===\n`
      );
      outStream.end();

      // ── Mark session as inactive ──
      isSessionActive = false;
      activeSessionPid = null;
      log.info('Session marked inactive');
    });

    child.unref();

    const relativeLog = path.relative(process.cwd(), logPath);
    log.info('Process started', { pid: child.pid, log: relativeLog, platform });

    return res.status(202).json({
      started: true,
      platform,
      pid: child.pid,
      log: relativeLog,
    });
  } catch (err) {
    log.error('Failed to start joinMeeting', { error: err.message, platform });
    return res.status(500).json({
      error: 'Failed to start joinMeeting',
      platform,
      details: err.message,
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Health endpoints                                                   */
/* ------------------------------------------------------------------ */
app.get('/', (_req, res) => {
  res.json({
    status: 'running',
    service: 'automation-service',
    supportedPlatforms: ['google', 'zoom', 'teams'],
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/*  Start server                                                       */
/* ------------------------------------------------------------------ */
const server = app.listen(PORT, () => {
  log.info('Automation Service started', {
    port: PORT,
    logsDir: LOGS_DIR,
    platforms: ['google', 'zoom', 'teams'],
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    log.error('Port already in use', { port: PORT });
    console.error(`Port ${PORT} is already in use. Another automation-service instance may be running.`);
    process.exit(1);
  }
  log.error('Server error', { error: err && err.message });
});
