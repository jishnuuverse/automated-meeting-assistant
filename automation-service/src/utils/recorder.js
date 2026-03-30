'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const { triggerTranscription } = require('../../sttClient');

const log = createLogger('Recorder');

/**
 * Self-contained audio recorder that wraps FFmpeg.
 * Extracted from the original joinMeeting.js to be shared across adapters.
 */
class Recorder {
  constructor() {
    this._process = null;
    this._outputPath = null;
    this._meetingId = null;
    this._stopPromise = null;
  }

  /** Whether a recording is currently active. */
  get isRecording() {
    return this._process !== null;
  }

  /**
   * Start recording meeting audio via FFmpeg/PulseAudio monitor.
   *
   * @param {string} meetingId - Unique meeting identifier (used for transcript naming).
   */
  start(meetingId) {
    if (this._process) {
      log.info('Recording already running, skipping new start');
      return;
    }

    const recordingsDir = path.join(__dirname, '..', '..', '..', 'logs', 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this._outputPath = path.join(recordingsDir, `meeting-${ts}.wav`);
    this._meetingId = meetingId;

    // Whisper-optimised: mono, 16 kHz, 16-bit PCM, WAV
    const monitorSource = process.env.PULSE_MONITOR_SOURCE
      || 'alsa_output.pci-0000_00_05.0.analog-stereo.monitor';

    const ffmpegArgs = [
      '-f', 'pulse',
      '-i', monitorSource,
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      this._outputPath,
    ];

    log.info('Starting FFmpeg recording', {
      meetingId,
      monitorSource,
      outputPath: this._outputPath,
    });

    const recorder = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    recorder.stdout.on('data', (d) => log.debug(`ffmpeg: ${d.toString().trim()}`));
    recorder.stderr.on('data', (d) => log.debug(`ffmpeg: ${d.toString().trim()}`));
    recorder.on('error', (err) => log.error('Failed to start ffmpeg', { error: err.message }));
    recorder.on('spawn', () => log.info(`FFmpeg started (pid=${recorder.pid})`));

    this._process = recorder;
    log.info('Recording started');
  }

  /**
   * Stop the recording, wait for FFmpeg to flush, then trigger transcription.
   *
   * @param {string} reason - Human-readable reason for stopping.
   * @returns {Promise<void>}
   */
  async stop(reason) {
    if (!this._process && !this._stopPromise) return;
    if (this._stopPromise) {
      await this._stopPromise;
      return;
    }

    const processToStop = this._process;
    const audioFilePath = this._outputPath;
    const meetingId = this._meetingId;
    const processingMode = process.env.PROCESSING_MODE || 'cloud';

    this._process = null;
    this._outputPath = null;
    this._meetingId = null;

    this._stopPromise = (async () => {
      log.info(`Stopping recording (${reason})`);

      if (processToStop) {
        await new Promise((resolve) => {
          let settled = false;
          const finalize = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const timeoutId = setTimeout(finalize, 15_000);
          processToStop.once('close', () => {
            clearTimeout(timeoutId);
            finalize();
          });
          try {
            processToStop.kill('SIGINT');
          } catch (err) {
            clearTimeout(timeoutId);
            log.error('Failed to stop ffmpeg', { error: err.message });
            finalize();
          }
        });
      }

      log.info('Recording stopped');

      if (!meetingId || !audioFilePath) {
        log.info('Skipping transcription: missing meetingId or audio path');
        return;
      }

      try {
        log.info(`Starting transcription for meetingId=${meetingId} processing_mode=${processingMode}`);
        const result = await triggerTranscription(meetingId, audioFilePath, processingMode);
        const transcriptText = result?.transcript || '';
        log.info(`Transcription complete (${transcriptText.length} chars)`);
      } catch (err) {
        log.warn('Transcription failed (continuing)', { error: err.message });
      }
    })();

    try {
      await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }
}

module.exports = Recorder;
