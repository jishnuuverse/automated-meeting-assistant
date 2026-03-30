'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const BaseAdapter = require('./BaseAdapter');
const Recorder = require('../utils/recorder');

/**
 * Google Meet adapter using Playwright browser automation.
 *
 * Implements Call End Strategy 1:
 *   - "Meeting ended" message detected
 *   - Participant count drops to 1 (self only)
 *   - Leave button disappears (3 consecutive misses)
 *   - Page URL navigates away from meet.google.com
 *
 * Exit sequence (always in this order):
 *   1. Stop FFmpeg recording
 *   2. Click "Leave call" button
 *   3. Close browser context
 */
class GoogleMeetAdapter extends BaseAdapter {
  constructor() {
    super('google');
    this._context = null;
    this._page = null;
    this._recorder = new Recorder();
    this._meetingId = null;
  }

  /* ------------------------------------------------------------------ */
  /*  join()                                                             */
  /* ------------------------------------------------------------------ */

  async join(options) {
    const { url, braveExecutable, userDataDir } = options;

    this._validatePaths(braveExecutable, userDataDir);

    // Resolve the actual binary path. Shell wrappers like /usr/bin/brave-browser
    // can detect a running Brave instance and hand off via IPC instead of
    // starting a new process, which breaks Playwright's debugging pipe.
    const resolvedExecutable = this._resolveActualBinary(braveExecutable);

    // Use a fixed automation-specific profile derived from userDataDir.
    // This preserves login state / cookies between sessions so we
    // never launch a brand-new browser for every meeting.
    const automationDataDir = `${userDataDir}-automation`;
    if (!fs.existsSync(automationDataDir)) {
      fs.mkdirSync(automationDataDir, { recursive: true });
    }

    // Remove stale lock/socket files left by a previous crashed session so
    // Playwright can open the profile without conflict.
    for (const staleFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const fp = path.join(automationDataDir, staleFile);
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch { /* ignore */ }
      }
    }

    this.log.info('Launching browser (reusing automation profile)', {
      url,
      automationDataDir,
      resolvedExecutable,
    });

    this._context = await chromium.launchPersistentContext(automationDataDir, {
      headless: false,
      executablePath: resolvedExecutable,
      timeout: 60_000, // 60 s launch timeout (fail fast instead of 180 s default)
      permissions: ['camera', 'microphone'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-session-crashed-bubble',
        '--no-default-browser-check',
        '--disable-infobars',
        // Sandbox — required when running under xvfb-run / as non-root
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // GPU workarounds — required in VM / headless environments
        '--disable-gpu',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        // Prevent renderer crashes on Google Meet's WebRTC/WebGL pages
        '--disable-webgl',
        '--disable-webgl2',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-video-decode',
        '--disable-accelerated-video-encode',
        // Keep renderer alive
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-hang-monitor',
        // Session restore can cause extra tabs / crash dialogs
        '--disable-session-crashed-bubble',
        '--disable-features=TranslateUI',
        '--hide-crash-restore-bubble',
      ],
    });
    this.log.info('Browser launched successfully');

    // ── Navigate to meeting with retry logic ─────────────────────────
    // The renderer can crash on Google Meet (especially in VM environments
    // with another Brave instance running). If that happens, create a
    // fresh page and retry.
    const MAX_NAV_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
      try {
        await this._setupPageAndNavigate(url, attempt);
        // If we get here, navigation succeeded and page is alive
        break;
      } catch (navErr) {
        this.log.warn(`Navigation attempt ${attempt}/${MAX_NAV_RETRIES} failed`, {
          error: navErr.message,
        });
        if (attempt === MAX_NAV_RETRIES) {
          throw new Error(
            `Browser page crashed ${MAX_NAV_RETRIES} times navigating to Google Meet. `
            + `This usually happens when another Brave instance is running. `
            + `Error: ${navErr.message}`
          );
        }
        // Small backoff before retry
        await this._sleep(3_000 * attempt);
      }
    }

    await this._disableMediaDevices();
    await this._clickJoinButton();
  }

  /**
   * Set up a fresh page, navigate to the meeting URL, and wait for Meet UI.
   * Throws if the page crashes or Meet UI can't be loaded.
   */
  async _setupPageAndNavigate(url, attempt) {
    // Close any existing pages and start fresh
    const existingPages = this._context.pages();
    if (attempt === 1) {
      // First attempt: re-use the default page, close extras
      this._page = existingPages.length > 0 ? existingPages[0] : await this._context.newPage();
      for (let i = 1; i < existingPages.length; i++) {
        await existingPages[i].close().catch(() => {});
      }
    } else {
      // Retry: close all pages and create a brand-new one
      for (const p of this._context.pages()) {
        await p.close().catch(() => {});
      }
      this._page = await this._context.newPage();
    }

    // Track if the page crashes (renderer process dies)
    let pageCrashed = false;
    let pageClosedUnexpectedly = false;

    this._page.on('crash', () => {
      this.log.error(`Page renderer crashed (attempt ${attempt})`);
      pageCrashed = true;
    });

    this._page.on('close', () => {
      if (!this._disposed) {
        pageClosedUnexpectedly = true;
        this.log.warn(`Page closed unexpectedly (attempt ${attempt})`);
      }
      this._recorder.stop('page closed').catch((err) => {
        this.log.error('Stop recording failed after page close', { error: err.message });
      });
    });

    this.log.info(`Navigating to meeting URL (attempt ${attempt})`);
    await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Verify the page survived navigation
    await this._sleep(2_000);
    if (pageCrashed || pageClosedUnexpectedly || this._page.isClosed()) {
      throw new Error('Page crashed or closed after navigation');
    }

    await this._waitForMeetUI();

    // Verify page is still alive after waiting for UI
    if (pageCrashed || pageClosedUnexpectedly || this._page.isClosed()) {
      throw new Error('Page crashed or closed while waiting for Meet UI');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  monitor() — Call End Strategy 1                                    */
  /* ------------------------------------------------------------------ */

  async monitor() {
    this.log.info('Monitoring meeting status (Call End Strategy 1)');

    // Short initial wait — just enough for the meeting UI to stabilise
    await this._sleep(10_000);

    if (this._page.isClosed()) {
      this.log.warn('Page already closed before monitoring could start');
      return;
    }

    this.log.info('Starting meeting-end detection loop (every 5 s)');

    let leaveButtonMissCount = 0;
    let unknownParticipantCount = 0; // track consecutive -1 (can't read count)

    while (true) {
      try {
        // 1. Page closed
        if (this._page.isClosed()) {
          this.log.info('Meeting end detected: page closed');
          break;
        }

        // 2. Navigated away from Google Meet or back to landing page
        const currentUrl = this._page.url();
        if (!currentUrl.includes('meet.google.com')) {
          this.log.info('Meeting end detected: navigated away from Meet');
          break;
        }
        // Host ended → Google Meet redirects to the landing page or a short URL without meeting code
        const meetPath = new URL(currentUrl).pathname;
        if (meetPath === '/' || meetPath === '') {
          this.log.info('Meeting end detected: redirected to Meet landing page');
          break;
        }

        // 3. DOM status check
        const status = await this._evaluateMeetingStatus();

        // Log every check so we can debug from the log file
        this.log.info('Monitor check', {
          state: status.state,
          hasLeaveButton: status.hasLeaveButton,
          participantCount: status.participantCount,
          leaveButtonMissCount,
          unknownParticipantCount,
          bodySnippet: status.bodySnippet || '',
        });

        // Update leave-button miss counter
        if (status.hasLeaveButton) {
          leaveButtonMissCount = 0;
        } else {
          leaveButtonMissCount++;
        }

        // Explicit meeting-ended text
        if (status.state === 'ended') {
          this.log.info('Meeting end detected: ended text on page');
          break;
        }

        // Page inaccessible
        if (status.state === 'page-error') {
          this.log.info('Meeting end detected: page inaccessible');
          break;
        }

        // Participant count dropped to 0 or 1
        if (status.participantCount === 0) {
          this.log.info('Meeting end detected: participant count is 0');
          break;
        }
        if (status.participantCount === 1) {
          this.log.info('Meeting end detected: only self remaining');
          break;
        }

        // Track unknown participant count (-1 = selectors didn't match)
        if (status.participantCount === -1) {
          unknownParticipantCount++;
          // If we also lost the leave button, the meeting is probably over
          if (!status.hasLeaveButton) {
            this.log.info('Meeting end detected: no participants found and no leave button');
            break;
          }
        } else {
          unknownParticipantCount = 0;
        }

        // Leave button disappeared 3 times in a row
        if (leaveButtonMissCount >= 3) {
          this.log.info('Meeting end detected: leave button missing 3 consecutive checks');
          break;
        }
      } catch {
        this.log.info('Meeting end detected: page inaccessible (exception)');
        break;
      }

      await this._sleep(5_000);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  leave() — guaranteed cleanup                                       */
  /* ------------------------------------------------------------------ */

  async leave() {
    if (this._disposed) return;
    this._markDisposed();

    // 1. Stop FFmpeg first (always)
    this.log.info('Stopping recording');
    await this._recorder.stop('meeting ended');

    // 2. Click "Leave call" button if possible
    try {
      if (this._page && !this._page.isClosed()) {
        const leaveBtn = this._page
          .locator('[aria-label="Leave call"], [aria-label="Leave"], [data-tooltip="Leave call"]')
          .first();
        if (await leaveBtn.isVisible({ timeout: 2_000 })) {
          await leaveBtn.click();
          this.log.info('Clicked "Leave call" button');
          await this._sleep(1_000);
        }
      }
    } catch (err) {
      this.log.debug('Could not click leave button', { error: err.message });
    }

    // 3. Close browser context (with force-kill fallback)
    try {
      if (this._context) {
        // Give context.close() a deadline; if it hangs, force-kill.
        await Promise.race([
          this._context.close(),
          this._sleep(10_000).then(() => {
            throw new Error('context.close() timed out');
          }),
        ]);
        this.log.info('Browser closed');
      }
    } catch (err) {
      this.log.warn('Graceful browser close failed, force-killing', { error: err.message });
      this._forceKillBrowserProcesses();
    }

    this._context = null;
    this._page = null;
    // NOTE: automation profile directory is intentionally kept on disk
    // so the next meeting session reuses the same browser profile.
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  _validatePaths(braveExecutable, userDataDir) {
    if (!braveExecutable || !fs.existsSync(braveExecutable)) {
      throw new Error(`Brave executable not found: ${braveExecutable}`);
    }
    if (!userDataDir || !fs.existsSync(userDataDir)) {
      throw new Error(`User data directory not found: ${userDataDir}`);
    }
  }

  /**
   * Resolve a shell-wrapper executable to the actual binary.
   *
   * /usr/bin/brave-browser is typically a symlink → shell script that runs
   * the real binary (e.g. /opt/brave.com/brave/brave). When another Brave
   * instance is already running, the wrapper can detect it via IPC and hand
   * off the URL, then exit — which breaks Playwright's debugging pipe.
   *
   * This method follows symlinks and parses simple wrapper scripts to find
   * the actual ELF binary that Playwright should launch directly.
   *
   * @param {string} exe - Path to the browser executable (may be a wrapper).
   * @returns {string} Resolved path to the actual binary.
   */
  _resolveActualBinary(exe) {
    try {
      // 1. Follow symlinks
      let resolved = fs.realpathSync(exe);

      // 2. If it's a shell script, try to extract the real binary path
      const head = fs.readFileSync(resolved, 'utf8').slice(0, 2);
      if (head === '#!') {
        this.log.info('Detected shell wrapper, resolving actual binary', { wrapper: resolved });

        // Common pattern in Chromium/Brave wrappers:
        //   "$HERE/brave" "$@" || true
        // Try to find the binary in the same dir or well-known locations.
        const candidates = [
          '/opt/brave.com/brave/brave',
          path.join(path.dirname(resolved), 'brave'),
          '/usr/lib/brave-browser/brave',
        ];

        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            // Verify it's an actual binary (ELF), not another wrapper
            try {
              const fileType = execSync(`file -b "${candidate}"`, {
                encoding: 'utf8',
                timeout: 3_000,
              }).trim();
              if (fileType.includes('ELF') || fileType.includes('executable')) {
                this.log.info('Resolved to actual binary', { binary: candidate });
                return candidate;
              }
            } catch { /* try next */ }
          }
        }

        this.log.warn('Could not resolve wrapper to actual binary, using as-is', {
          wrapper: resolved,
        });
        return resolved;
      }

      return resolved;
    } catch (err) {
      this.log.warn('Binary resolution failed, using original path', {
        exe,
        error: err.message,
      });
      return exe;
    }
  }

  /**
   * Force-kill any browser processes spawned by this adapter.
   * Used as a last resort when context.close() fails or hangs.
   */
  _forceKillBrowserProcesses() {
    try {
      // Kill Brave/Chromium processes using the automation profile
      execSync(
        `pkill -f -- "--user-data-dir=.*-automation" 2>/dev/null || true`,
        { stdio: 'ignore', timeout: 5_000 }
      );
      this.log.info('Force-killed lingering browser processes');
    } catch {
      this.log.debug('No lingering browser processes to kill (or pkill failed)');
    }
  }

  async _waitForMeetUI() {
    this.log.info('Waiting for Google Meet interface');

    // Bail out early if page is already dead
    if (this._page.isClosed()) {
      throw new Error('Page closed before Meet UI check');
    }

    // First check for error states that mean we can never join
    try {
      const errorState = await this._page.evaluate(() => {
        const body = (document.body ? document.body.innerText : '').toLowerCase();
        if (body.includes('check your meeting code') || body.includes('invalid meeting'))
          return 'invalid-code';
        if (body.includes('meeting has ended') || body.includes('this meeting has ended'))
          return 'meeting-ended';
        if (body.includes('not allowed') || body.includes('denied') || body.includes('you can\'t join'))
          return 'access-denied';
        if (body.includes('sign in') && !body.includes('join'))
          return 'sign-in-required';
        return null;
      });
      if (errorState) {
        throw new Error(`Google Meet error state: ${errorState}`);
      }
    } catch (err) {
      if (err.message.includes('Google Meet error state')) throw err;
      // If evaluate fails because page closed/crashed, propagate it
      if (err.message.includes('closed') || err.message.includes('crash')) {
        throw new Error(`Page died during error-state check: ${err.message}`);
      }
      this.log.debug('Error state check inconclusive', { error: err.message });
    }

    try {
      await this._page.waitForFunction(() => {
        return (
          document.querySelector(
            '[role="button"][aria-label*="join"], [role="button"][aria-label*="Join"], [data-testid*="join"]'
          ) ||
          document.querySelector(
            '[role="button"][aria-label*="camera"], [role="button"][aria-label*="microphone"]'
          )
        );
      }, { timeout: 30_000 });
      this.log.info('Google Meet interface detected');
    } catch (err) {
      // If the page crashed/closed, throw so the retry loop can handle it
      if (this._page.isClosed() || err.message.includes('closed') || err.message.includes('crash')) {
        throw new Error(`Page crashed while waiting for Meet UI: ${err.message}`);
      }
      // Capture a screenshot for debugging before proceeding
      await this._captureDebugScreenshot('wait-for-ui-failed');
      this.log.warn('Meet interface not detected within 30 s — proceeding anyway', {
        error: err.message,
      });
    }
    await this._sleep(2_000);
  }

  async _disableMediaDevices() {
    this.log.info('Disabling camera and microphone');

    // Keyboard shortcuts (most reliable)
    try {
      await this._page.keyboard.press('Control+KeyE');
      this.log.debug('Camera off (Ctrl+E)');
      await this._sleep(500);
    } catch { /* ignore */ }

    try {
      await this._page.keyboard.press('Control+KeyD');
      this.log.debug('Microphone off (Ctrl+D)');
      await this._sleep(500);
    } catch { /* ignore */ }

    // Fallback: click buttons
    for (const label of ['Turn off camera', 'Turn off microphone']) {
      try {
        const btn = this._page.getByRole('button', { name: label });
        if (await btn.isVisible({ timeout: 1_000 })) {
          await btn.click();
          this.log.debug(`Clicked "${label}" button`);
        }
      } catch { /* ignore */ }
    }
  }

  async _clickJoinButton() {
    this.log.info('Attempting to join meeting');

    const selectors = [
      { role: 'button', name: 'Ask to join' },
      { role: 'button', name: 'Join now' },
      { role: 'button', name: 'Join' },
    ];

    let clickedButton = null;

    for (const sel of selectors) {
      try {
        const btn = this._page.getByRole(sel.role, { name: sel.name });
        await btn.click({ timeout: 5_000 });
        this.log.info(`Clicked "${sel.name}" button`);
        clickedButton = sel.name;
        break;
      } catch { /* try next */ }
    }

    // Generic text search
    if (!clickedButton) {
      try {
        const anyJoin = this._page.locator('button').filter({ hasText: /join/i });
        await anyJoin.first().click({ timeout: 5_000 });
        this.log.info('Clicked generic "join" button');
        clickedButton = 'join (generic)';
      } catch { /* last resort */ }
    }

    // Enter key fallback
    if (!clickedButton) {
      try {
        await this._page.keyboard.press('Enter');
        this.log.info('Pressed Enter as join fallback');
        clickedButton = 'Enter key';
      } catch { /* Enter didn't work either */ }
    }

    if (!clickedButton) {
      // All strategies exhausted — capture debug info and throw
      await this._captureDebugScreenshot('join-failed');
      try {
        const bodyText = await this._page.evaluate(() =>
          (document.body ? document.body.innerText : '').substring(0, 500)
        );
        this.log.error('Page content at join failure', { bodyText });
      } catch { /* ignore */ }
      throw new Error(
        'Could not join meeting: no join button found. The meeting may have ended, '
        + 'the link may be invalid, or the host has not started the meeting yet.'
      );
    }

    // ── Wait for host to admit us (up to 2 minutes) ────────────────────
    // "Ask to join" puts us in a waiting room; "Join now" lets us in instantly.
    // Either way, we wait for the leave button to confirm we're in the meeting.
    const ADMIT_TIMEOUT_MS = 120_000; // 2 minutes
    const POLL_INTERVAL_MS = 3_000;
    const leaveSelector =
      '[aria-label="Leave call"], [aria-label="Leave"], [data-tooltip="Leave call"]';

    this.log.info('Waiting for host to admit us into the meeting (max 2 min)…');
    const admitDeadline = Date.now() + ADMIT_TIMEOUT_MS;
    let admitted = false;

    while (Date.now() < admitDeadline) {
      // Check if page is still alive
      if (this._page.isClosed()) {
        throw new Error('Page closed while waiting for host to admit');
      }

      // Check for denial / meeting-ended states while waiting
      try {
        const waitState = await this._page.evaluate(() => {
          const body = (document.body ? document.body.innerText : '').toLowerCase();
          if (body.includes('you can\'t join') || body.includes('not allowed') ||
              body.includes('denied') || body.includes('request was denied'))
            return 'denied';
          if (body.includes('meeting has ended') || body.includes('check your meeting code') ||
              body.includes('invalid meeting'))
            return 'ended';
          return null;
        });
        if (waitState === 'denied') {
          throw new Error('Host denied the join request');
        }
        if (waitState === 'ended') {
          throw new Error('Meeting ended while waiting to be admitted');
        }
      } catch (err) {
        if (err.message.includes('denied') || err.message.includes('ended') ||
            err.message.includes('admitted')) throw err;
        // evaluate failed — page may have closed, will be caught next iteration
      }

      // Check if leave button is now visible (means we're in the meeting)
      try {
        const leaveBtn = this._page.locator(leaveSelector).first();
        if (await leaveBtn.isVisible({ timeout: 1_000 })) {
          admitted = true;
          break;
        }
      } catch { /* not visible yet, keep polling */ }

      const remaining = Math.round((admitDeadline - Date.now()) / 1_000);
      this.log.debug(`Still waiting for admission… ${remaining}s remaining`);
      await this._sleep(POLL_INTERVAL_MS);
    }

    if (!admitted) {
      await this._captureDebugScreenshot('admit-timeout');
      throw new Error(
        'Host did not admit us within 2 minutes. Giving up and leaving.'
      );
    }

    this.log.info('Admitted into the meeting — starting recording');
    this._meetingId = `meeting-${Date.now()}`;
    this._recorder.start(this._meetingId);
    await this._sleep(1_000);
  }

  /**
   * Evaluate live DOM to determine meeting state.
   * @returns {Promise<{state: string, hasLeaveButton: boolean, participantCount: number}>}
   */
  async _evaluateMeetingStatus() {
    return this._page
      .evaluate(() => {
        const body = document.body ? document.body.innerText : '';
        const lowered = body.toLowerCase();
        // Short snippet for log debugging
        const bodySnippet = body.substring(0, 300).replace(/\n/g, ' ');

        // Explicit meeting-ended / host-removed text
        const endedPhrases = [
          'you left the meeting',
          'meeting has ended',
          'return to home screen',
          'you have left the meeting',
          'you\'ve been removed',
          'you were removed',
          'removed from the meeting',
          'the call ended',
          'call has ended',
          'you can\'t rejoin',
          'this meeting has been ended by',
          'meeting ended by host',
          'meeting has been ended',
          'no longer in this call',
          'this video call has ended',
          'the video call ended',
          'you\'ve left the meeting',
        ];
        if (endedPhrases.some((phrase) => lowered.includes(phrase))) {
          return { state: 'ended', hasLeaveButton: false, participantCount: 0, bodySnippet };
        }

        // "Rejoin" button visible means we've been kicked out of the meeting
        const rejoinBtn = document.querySelector(
          'button[data-mdc-dialog-action="rejoin"], [aria-label="Rejoin"], [jsname="oI7Fj"]'
        );
        if (rejoinBtn) {
          return { state: 'ended', hasLeaveButton: false, participantCount: 0, bodySnippet };
        }

        // Leave button
        const leaveBtn = document.querySelector(
          '[aria-label="Leave call"], [aria-label="Leave"], [data-tooltip="Leave call"]'
        );
        const hasLeaveButton = !!leaveBtn;

        // ── Participant count — try multiple strategies ──
        let participantCount = -1;

        // Strategy 1: well-known selectors for the participant-count badge
        const participantSelectors = [
          '[data-participant-count]',
          '.gFyGKf',
          '[aria-label*="participant"]',
          '[data-tooltip*="participant"]',
          'button[aria-label*="people"] span',
          'button[aria-label*="People"] span',
          '.uGOf1d',
          '.rua5Nb',
          '.wnPUne',
        ];
        for (const sel of participantSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text =
              el.textContent ||
              el.getAttribute('aria-label') ||
              el.getAttribute('data-tooltip') ||
              '';
            const match = text.match(/(\d+)/);
            if (match) {
              participantCount = parseInt(match[1], 10);
              break;
            }
          }
        }

        // Strategy 2: scan ALL buttons/spans for anything that looks like
        // a people/participant count (Google Meet changes class names often)
        if (participantCount === -1) {
          const allBtns = document.querySelectorAll(
            'button[aria-label], [role="button"][aria-label]'
          );
          for (const btn of allBtns) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('people') || label.includes('participant') || label.includes('show everyone')) {
              // The count might be in a child span or the aria-label itself
              const countText = btn.textContent || label;
              const m = countText.match(/(\d+)/);
              if (m) {
                participantCount = parseInt(m[1], 10);
                break;
              }
            }
          }
        }

        // Strategy 3: count participant tiles / video feeds
        if (participantCount === -1) {
          const tiles = document.querySelectorAll(
            '[data-participant-id], [data-requested-participant-id]'
          );
          if (tiles.length > 0) participantCount = tiles.length;
        }

        // Strategy 4: count video elements (each participant usually has one)
        if (participantCount === -1) {
          const videos = document.querySelectorAll('video');
          if (videos.length > 0) participantCount = videos.length;
        }

        // Strategy 5: look for the number in the body text near "in call" / "people"
        if (participantCount === -1) {
          const m = lowered.match(/(\d+)\s*(?:in call|people|participants?)/);
          if (m) participantCount = parseInt(m[1], 10);
        }

        return {
          state: hasLeaveButton ? 'active' : 'no-leave-btn',
          hasLeaveButton,
          participantCount,
          bodySnippet,
        };
      })
      .catch(() => ({ state: 'page-error', hasLeaveButton: false, participantCount: -1, bodySnippet: '' }));
  }

  /**
   * Capture a screenshot for debugging (best-effort).
   * @param {string} label
   */
  async _captureDebugScreenshot(label) {
    try {
      if (!this._page || this._page.isClosed()) return;
      const dir = path.join(__dirname, '..', '..', '..', 'logs', 'screenshots');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(dir, `${label}-${ts}.png`);
      await this._page.screenshot({ path: filePath, fullPage: true });
      this.log.info(`Debug screenshot saved: ${filePath}`);
    } catch (err) {
      this.log.debug('Failed to capture debug screenshot', { error: err.message });
    }
  }

  /** @param {number} ms */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = GoogleMeetAdapter;
