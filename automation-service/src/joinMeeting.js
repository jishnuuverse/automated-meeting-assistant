'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

/**
 * joinMeeting.js — Thin orchestrator for multi-platform meeting automation.
 *
 * Called by server.js as a detached child process:
 *   node joinMeeting.js <meetingUrl> [braveExecutable] [userDataDir]
 *
 * 1. Detects the platform from the URL.
 * 2. Creates the appropriate adapter via the factory.
 * 3. Runs adapter.run(options)  →  join() → monitor() → leave()
 * 4. Ensures cleanup on SIGINT / SIGTERM / uncaught errors.
 */

const { createAdapter } = require('./platform/adapterFactory');
const { detectPlatform } = require('./platform/detectPlatform');
const { createLogger } = require('./utils/logger');

const log = createLogger('Orchestrator');

(async () => {
  let adapter = null;

  try {
    // ── Parse CLI arguments ──────────────────────────────────────────
    const meetUrl = process.argv[2];
    const braveExecutable = process.argv[3] || null;
    const userDataDir = process.argv[4] || null;

    log.info('Starting meeting join process', { time: new Date().toISOString() });

    if (!meetUrl) {
      log.error('Missing required argument: meetingUrl');
      process.exit(1);
    }

    const platform = detectPlatform(meetUrl);
    log.info('Platform detected', { platform, url: meetUrl });

    // ── Create adapter ───────────────────────────────────────────────
    adapter = createAdapter(meetUrl);

    // ── Build platform-specific options ──────────────────────────────
    const options = { url: meetUrl };

    if (platform === 'google' || platform === 'zoom') {
      if (!braveExecutable || !userDataDir) {
        log.error(`${platform} requires braveExecutable and userDataDir`);
        process.exit(1);
      }
      options.braveExecutable = braveExecutable;
      options.userDataDir = userDataDir;
    }

    // ── Register signal handlers for graceful shutdown ───────────────
    const gracefulShutdown = async (signal) => {
      log.info(`Received ${signal}, cleaning up`);
      try {
        await adapter.leave();
      } catch (err) {
        log.error(`Cleanup failed on ${signal}`, { error: err.message });
      }
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // ── Run the full lifecycle ───────────────────────────────────────
    await adapter.run(options);

    log.info('Meeting join process completed', {
      platform,
      time: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Fatal error', { error: err.message, stack: err.stack });

    // Safety net: ensure recording stops and resources are freed
    if (adapter) {
      try {
        await adapter.leave();
      } catch { /* already logged inside adapter */ }
    }

    process.exit(1);
  }
})();
