const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4001;

app.post('/api/meetings', (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 RECEIVED REQUEST at', new Date().toISOString());
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Extract data strictly from frontend
  const { url, userDataDir, braveExecutable } = req.body || {};

  // Persist request log
  try {
    const logsDirImmediate = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDirImmediate)) {
      fs.mkdirSync(logsDirImmediate, { recursive: true });
    }

    const reqLog = path.join(logsDirImmediate, 'requests.log');
    fs.appendFileSync(
      reqLog,
      `${new Date().toISOString()} ${JSON.stringify(req.body)}\n`
    );
  } catch (e) {
    console.error('❌ Failed to write request log', e);
  }

  // Validation (explicit & predictable)
  if (!url) {
    console.log('❌ VALIDATION FAILED: Missing url');
    return res.status(400).json({ error: 'Missing url' });
  }

  if (!userDataDir) {
    console.log('❌ VALIDATION FAILED: Missing userDataDir');
    return res.status(400).json({ error: 'Missing userDataDir' });
  }

  if (!braveExecutable) {
    console.log('❌ VALIDATION FAILED: Missing braveExecutable');
    return res.status(400).json({ error: 'Missing braveExecutable' });
  }

  console.log('✅ Validation passed');
  console.log('📋 Configuration:');
  console.log('   URL:', url);
  console.log('   Profile:', userDataDir);
  console.log('   Executable:', braveExecutable);

  const scriptPath = path.join(__dirname, 'joinMeeting.js');
  const args = [scriptPath, url, braveExecutable, userDataDir];

  console.log('🚀 Spawning joinMeeting process...');
  console.log('   Script:', scriptPath);
  console.log('   Args:', args.join(' | '));

  try {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const ts = Date.now();
    const logPath = path.join(logsDir, `join-${ts}-${child.pid}.log`);
    const outStream = fs.createWriteStream(logPath, { flags: 'a' });

    outStream.write(
      `=== spawn ${new Date().toISOString()} pid=${child.pid} args=${args.join(
        ' '
      )} ===\n`
    );

    if (child.stdout) child.stdout.pipe(outStream);
    if (child.stderr) child.stderr.pipe(outStream);

    child.on('exit', (code, signal) => {
      console.log(
        `🔴 Process ${child.pid} exited with code=${code} signal=${signal}`
      );
      outStream.write(
        `=== exit code=${code} signal=${signal} at ${new Date().toISOString()} ===\n`
      );
      outStream.end();
    });

    child.unref();

    const relativeLog = path.relative(process.cwd(), logPath);

    console.log('✅ Process started successfully');
    console.log('   PID:', child.pid);
    console.log('   Log:', relativeLog);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return res.status(202).json({
      started: true,
      pid: child.pid,
      log: relativeLog,
    });
  } catch (err) {
    console.error('❌ Failed to start joinMeeting');
    console.error(err);

    return res.status(500).json({
      error: 'Failed to start joinMeeting',
      details: err.message,
    });
  }
});

/**
 * Health endpoints
 */
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'automation-service',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 Automation Service Started');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📡 Listening on: http://localhost:${PORT}`);
  console.log(`📁 Logs directory: ${path.join(__dirname, '..', '..', 'logs')}`);
  console.log(`🕐 Started at: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('Waiting for requests...');
  console.log('');
});
