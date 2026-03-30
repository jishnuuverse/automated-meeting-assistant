'use strict';

const { createLogger } = require('../utils/logger');

/**
 * Abstract base class for all meeting-platform adapters.
 *
 * Every concrete adapter MUST implement:
 *   - join(options)    → Connect to the meeting and start recording.
 *   - monitor()        → Watch for meeting-end signals (blocks until meeting ends).
 *   - leave()          → Leave the meeting and perform cleanup.
 *
 * Lifecycle (called by the orchestrator):
 *   1. adapter.join(options)
 *   2. adapter.monitor()       // resolves when meeting ends
 *   3. adapter.leave()         // always called, even after errors
 */
class BaseAdapter {
  /**
   * @param {string} platform - Platform identifier (e.g. "google", "zoom", "teams").
   */
  constructor(platform) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly.');
    }
    this.platform = platform;
    this.log = createLogger(this.constructor.name);
    this._disposed = false;
  }

  /* ------------------------------------------------------------------ */
  /*  Abstract methods – subclasses MUST override                       */
  /* ------------------------------------------------------------------ */

  /**
   * Join the meeting, disable mic/camera where applicable,
   * and begin recording.
   *
   * @param {object} options - Platform-specific options passed from the request.
   * @returns {Promise<void>}
   */
  async join(_options) {
    throw new Error(`${this.constructor.name} must implement join()`);
  }

  /**
   * Monitor the meeting status and resolve when the meeting has ended.
   * Implementations should poll or use webhooks/events as appropriate.
   *
   * @returns {Promise<void>}
   */
  async monitor() {
    throw new Error(`${this.constructor.name} must implement monitor()`);
  }

  /**
   * Leave the meeting, stop recording, and release all resources.
   * Must be safe to call multiple times (idempotent).
   *
   * @returns {Promise<void>}
   */
  async leave() {
    throw new Error(`${this.constructor.name} must implement leave()`);
  }

  /* ------------------------------------------------------------------ */
  /*  Shared helpers                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Run the full adapter lifecycle with guaranteed cleanup.
   * This is the primary entry-point called by the orchestrator.
   *
   * @param {object} options
   * @returns {Promise<void>}
   */
  async run(options) {
    try {
      this.log.info('Starting meeting lifecycle', { platform: this.platform });

      await this.join(options);
      this.log.info('Meeting joined successfully');

      await this.monitor();
      this.log.info('Meeting end detected');
    } catch (err) {
      this.log.error('Error during meeting lifecycle', { error: err.message });
      throw err;
    } finally {
      // Ensure leave() is always called – recording must stop.
      try {
        await this.leave();
        this.log.info('Meeting left and resources released');
      } catch (leaveErr) {
        this.log.error('Error during leave/cleanup', { error: leaveErr.message });
      }
    }
  }

  /** Mark the adapter as disposed so duplicate cleanup calls are no-ops. */
  _markDisposed() {
    this._disposed = true;
  }
}

module.exports = BaseAdapter;
