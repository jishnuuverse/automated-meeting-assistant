'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const BaseAdapter = require('./BaseAdapter');
const Recorder = require('../utils/recorder');

/**
 * Zoom adapter using the official Zoom API / SDK.
 *
 * This adapter does NOT use browser automation — it communicates with
 * Zoom's REST API (and optionally the Meeting SDK) to:
 *   - Start / connect to a meeting via API
 *   - Begin cloud or local recording
 *   - Monitor meeting status via polling / webhooks
 *   - Stop recording and leave when the meeting ends
 *
 * Required environment variables:
 *   ZOOM_API_KEY      – Zoom Server-to-Server OAuth app client ID
 *   ZOOM_API_SECRET   – Zoom Server-to-Server OAuth app client secret
 *   ZOOM_ACCOUNT_ID   – Zoom account ID for S2S OAuth
 *   ZOOM_WEBHOOK_SECRET (optional) – for webhook verification
 *
 * NOTE: Full Zoom SDK integration requires a native binary.
 *       This adapter provides the API scaffolding; wire in the SDK
 *       or webhooks as your deployment requires.
 */
class ZoomAdapter extends BaseAdapter {
  constructor() {
    super('zoom');
    this._context = null;
    this._page = null;
    this._recorder = new Recorder();
    this._meetingId = null;
    this._zoomMeetingId = null;
    this._pollInterval = null;
    this._accessToken = null;
    this._tempUserDataDir = null;
  }

  /* ------------------------------------------------------------------ */
  /*  join()                                                             */
  /* ------------------------------------------------------------------ */

  async join(options) {
    const { url, braveExecutable, userDataDir } = options;

    // Validate browser paths for Zoom (similar to Google Meet)
    this._validatePaths(braveExecutable, userDataDir);

    this._zoomMeetingId = this._extractMeetingId(url);
    this._meetingId = `meeting-${Date.now()}`;

    this.log.info('Connecting to Zoom meeting via browser + API', {
      zoomMeetingId: this._zoomMeetingId,
      url,
      userDataDir,
    });

    // 1. Authenticate with Zoom API first to get meeting details
    try {
      this._accessToken = await this._authenticate();
      this.log.info('Zoom API authenticated');
      
      // Get meeting details to ensure it exists and is valid
      const meetingDetails = await this._getMeetingDetails(this._zoomMeetingId);
      this.log.info('Meeting details fetched', {
        topic: meetingDetails.topic,
        status: meetingDetails.status,
      });
    } catch (err) {
      this.log.warn('Could not authenticate with Zoom API, proceeding with browser-only', { error: err.message });
      this._accessToken = null;
    }

    // 2. Create a unique temporary profile to avoid conflicts
    const tempUserDataDir = `${userDataDir}-automation-${Date.now()}`;
    this._tempUserDataDir = tempUserDataDir;
    
    // 3. Launch browser with temporary profile
    this.log.info('Launching browser for Zoom with temporary profile', { tempUserDataDir });
    this._context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      executablePath: braveExecutable,
      permissions: ['camera', 'microphone'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-external-intent-requests',   // suppress xdg-open / protocol-handler dialogs
        '--disable-features=ExternalProtocolDialog',
      ],
    });
    this.log.info('Browser launched successfully');

    // Re-use the default blank page that launchPersistentContext already opens
    // so we don't end up with two tabs.
    const pages = this._context.pages();
    this._page = pages.length > 0 ? pages[0] : await this._context.newPage();

    // If the page is closed externally, stop recording as a safety net.
    this._page.on('close', () => {
      this._recorder.stop('page closed').catch((err) => {
        this.log.error('Stop recording failed after page close', { error: err.message });
      });
    });

    // ── Prevent extra tabs: when Zoom redirects and opens a new tab
    //    (e.g. app.zoom.us), adopt it as the main page.
    //    IMPORTANT: we do NOT close the old tab here — closing mid-flow causes
    //    "Target page … has been closed" errors in _handleZoomWebClientFlow.
    //    Old tabs are cleaned up by _closeExtraTabs() after the join flow.
    this._context.on('page', async (newPage) => {
      this.log.info('New tab/page opened — adopting it as main page', { url: newPage.url() });
      this._page = newPage;
      // Attach close safety net to the new page
      newPage.on('close', () => {
        this._recorder.stop('page closed').catch(() => {});
      });
    });

    // 4. Navigate to the Zoom **web-client** URL directly.
    //    zoom.us/wc/join/<id> loads the browser-based meeting UI and
    //    avoids the "Open xdg-open?" / "Open Zoom Workplace app?" prompt
    //    that zoom.us/j/<id> triggers.
    const wcUrl = this._constructWebClientUrl(url);
    this.log.info('Navigating to Zoom web-client URL', { wcUrl });
    await this._page.goto(wcUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 4b. Give a moment for any new-tab redirect to fire
    //     (Zoom may open app.zoom.us in a new tab during navigation)
    await this._sleep(2_000);

    // 5. Handle the entire join flow (name → join → computer audio)
    await this._handleZoomWebClientFlow();

    // 6. After join flow, close any leftover extra tabs
    await this._closeExtraTabs();
  }

  /* ------------------------------------------------------------------ */
  /*  monitor()                                                          */
  /* ------------------------------------------------------------------ */

  async monitor() {
    this.log.info('Monitoring Zoom meeting status via browser + API');

    const MAX_MONITOR_MS = 2 * 60 * 60 * 1000; // 2 hours max
    const POLL_INTERVAL_MS = 5_000;
    const LOG_EVERY_N = 12; // log status every ~60 seconds (12 × 5s)
    const monitorStart = Date.now();
    let pollCount = 0;

    // Let UI stabilise after joining
    await this._sleep(10_000);

    while (true) {
      pollCount++;

      // Safety: maximum monitoring timeout
      if (Date.now() - monitorStart > MAX_MONITOR_MS) {
        this.log.info('Meeting end detected: maximum monitoring time reached (2h)');
        break;
      }

      try {
        // 1. Page closed
        if (this._page.isClosed()) {
          this.log.info('Meeting end detected: page closed');
          break;
        }

        // 2. Navigated away from Zoom
        const currentUrl = this._page.url();
        if (!currentUrl.includes('zoom.us')) {
          this.log.info('Meeting end detected: navigated away from Zoom', { currentUrl });
          break;
        }

        // 3. Check page title for error state
        const pageTitle = await this._page.title().catch(() => '');
        if (pageTitle.toLowerCase().includes('error')) {
          this.log.info('Meeting end detected: error page', { pageTitle });
          await this._clickMeetingEndedOk();
          break;
        }

        // 4. Check for "meeting ended" dialog or text
        const meetingEnded = await this._checkMeetingEndedText();
        if (meetingEnded) {
          this.log.info('Meeting end detected: ended text/dialog on page');
          await this._clickMeetingEndedOk();
          break;
        }

        // 5. Optional: API status check if available
        if (this._accessToken) {
          try {
            const status = await this._getMeetingStatus(this._zoomMeetingId);
            if (status === 'ended' || status === 'waiting') {
              this.log.info('Meeting end detected via Zoom API', { status });
              break;
            }
          } catch (err) {
            if (err.statusCode === 404 || err.status === 404) {
              this.log.info('Meeting end detected: meeting no longer exists (API)');
              break;
            }
          }
        }

        // Periodic status log so we know the monitor is alive
        if (pollCount % LOG_EVERY_N === 0) {
          const elapsed = Math.round((Date.now() - monitorStart) / 1000);
          this.log.info('Monitor still active', { pollCount, elapsedSeconds: elapsed, pageTitle });
        }
      } catch {
        this.log.info('Meeting end detected: page inaccessible (exception)');
        break;
      }

      await this._sleep(POLL_INTERVAL_MS);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  leave()                                                            */
  /* ------------------------------------------------------------------ */

  async leave() {
    if (this._disposed) return;
    this._markDisposed();

    // Clear any active polling
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    // 1. Stop recording
    await this._recorder.stop('meeting ended');
    this.log.info('Local recording stopped');

    // 2. Click "OK" on meeting-ended dialog or "Leave"/"End" button
    try {
      if (this._page && !this._page.isClosed()) {
        // First try the meeting-ended OK dialog
        await this._clickMeetingEndedOk();

        // Then try Leave/End button (if still in meeting)
        const leaveBtn = this._page
          .locator('button:has-text("Leave"), button:has-text("End")')
          .first();
        if (await leaveBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await leaveBtn.click();
          this.log.info('Clicked "Leave" button');
          await this._sleep(1_000);
        }
      }
    } catch (err) {
      this.log.debug('Could not click leave/OK button', { error: err.message });
    }

    // 3. Close ALL open pages/tabs
    try {
      if (this._context) {
        const allPages = this._context.pages();
        for (const p of allPages) {
          if (!p.isClosed()) {
            await p.close().catch(() => {});
          }
        }
        this.log.info('All tabs closed');
      }
    } catch (err) {
      this.log.debug('Error closing pages', { error: err.message });
    }

    // 4. Close browser context
    try {
      if (this._context) {
        await this._context.close();
        this.log.info('Browser closed');
      }
    } catch (err) {
      this.log.debug('Browser context already closed', { error: err.message });
    }

    this._context = null;
    this._page = null;

    // 5. Clean up temporary user data directory
    if (this._tempUserDataDir && fs.existsSync(this._tempUserDataDir)) {
      try {
        fs.rmSync(this._tempUserDataDir, { recursive: true, force: true });
        this.log.info('Cleaned up temporary user data directory');
      } catch (err) {
        this.log.warn('Could not clean up temporary directory', { error: err.message });
      }
    }

    this.log.info('Zoom adapter resources released');
  }

  /* ------------------------------------------------------------------ */
  /*  Browser automation helpers (similar to GoogleMeetAdapter)         */
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
   * Build the Zoom **web-client** join URL.
   * Using /wc/join/ lands directly in the browser-based client and
   * never triggers the desktop-app / xdg-open prompt.
   */
  _constructWebClientUrl(originalUrl) {
    const meetingId = this._zoomMeetingId;
    const pwdMatch = originalUrl.match(/pwd=([^&]+)/);
    const password = pwdMatch ? pwdMatch[1] : '';

    // Preserve the subdomain if the original URL uses one (e.g. us05web.zoom.us)
    let host = 'zoom.us';
    try {
      const parsed = new URL(originalUrl);
      if (parsed.hostname.endsWith('.zoom.us')) {
        host = parsed.hostname;
      }
    } catch { /* keep default */ }

    return `https://${host}/wc/join/${meetingId}${password ? '?pwd=' + password : ''}`;
  }

  /* ------------------------------------------------------------------ */
  /*  Web-client join flow                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Full join flow for the Zoom **web client** (/wc/join/<id>).
   *
   * Typical page states that appear in order:
   *   1. "Join from browser" link (only when redirected from /j/<id>)
   *   2. Name input  +  "Join" button
   *   3. "Join with Computer Audio" button (after entering the meeting)
   *   4. Meeting lobby / waiting room
   */
  async _handleZoomWebClientFlow() {
    this.log.info('Handling Zoom web-client join flow');

    // Give the page a moment to stabilise after navigation / tab switch
    await this._sleep(4_000);

    // Ensure we're working with the latest page reference (may have changed via redirect)
    let pageTitle = '';
    let currentUrl = '';
    try {
      pageTitle = await this._page.title();
      currentUrl = this._page.url();
    } catch (err) {
      // Page may have closed and been replaced — wait and retry once
      this.log.warn('Page seems stale, waiting for redirect to settle', { error: err.message });
      await this._sleep(3_000);
      try {
        pageTitle = await this._page.title();
        currentUrl = this._page.url();
      } catch (retryErr) {
        this.log.error('Page still inaccessible after retry', { error: retryErr.message });
        throw retryErr;
      }
    }
    this.log.info('Page loaded', { title: pageTitle, url: currentUrl });

    // ── Step A: If we somehow still landed on the launcher page (/j/)
    //    click "Join from browser" to switch to the web client.
    await this._clickJoinFromBrowserIfPresent();

    // ── Step B: Enter a guest display name if required
    await this._enterDisplayName();

    // ── Step C: Click the main "Join" button on the pre-join screen
    await this._clickPreJoinButton();

    // ── Step D: Accept "Join with Computer Audio" if it appears
    await this._clickJoinAudio();

    // ── Step E: Dismiss any remaining pop-ups / tooltips
    await this._dismissOverlays();

    // ── Step F: Start local recording
    this._recorder.start(this._meetingId);
    this.log.info('Local recording started', { meetingId: this._meetingId });
  }

  /* ---------- A: "Join from browser" (launcher page only) ---------- */

  async _clickJoinFromBrowserIfPresent() {
    this.log.info('Checking for "Join from browser" link/button');

    const selectors = [
      // Zoom's launcher page renders this as a plain link or styled button
      'a:has-text("Join from browser")',
      'a:has-text("Join from Browser")',
      'a:has-text("Join from your browser")',
      'button:has-text("Join from browser")',
      'button:has-text("Join from Browser")',
      'text=Join from browser',
      'text=Join from Browser',
      '#joinBtn',
    ];

    for (const sel of selectors) {
      try {
        const el = this._page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible({ timeout: 2_000 }))) {
          this.log.info(`Clicking "Join from browser" via ${sel}`);
          await el.click();
          // Wait for the web-client page to load
          await this._page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
          await this._sleep(4_000);
          return;
        }
      } catch { /* try next selector */ }
    }

    this.log.info('No "Join from browser" link found — already on web-client page');
  }

  /* ---------- B: enter display name ------------------------------ */

  async _enterDisplayName() {
    this.log.info('Looking for display-name input');

    const nameSelectors = [
      '#inputname',
      'input[placeholder*="name" i]',      // case-insensitive
      'input[placeholder*="Name"]',
      'input[id*="name"]',
      'input[name*="name"]',
      'input[aria-label*="name" i]',
    ];

    for (const sel of nameSelectors) {
      try {
        const input = this._page.locator(sel).first();
        if ((await input.count()) > 0 && (await input.isVisible({ timeout: 3_000 }))) {
          // Clear any pre-filled value and type our name
          await input.click({ clickCount: 3 }); // triple-click to select all
          await input.fill('AutoBot');
          this.log.info('Entered display name: AutoBot');
          await this._sleep(500);
          return;
        }
      } catch { /* try next */ }
    }

    this.log.info('No name input found — may not be required');
  }

  /* ---------- C: click the main "Join" button -------------------- */

  async _clickPreJoinButton() {
    this.log.info('Clicking pre-join "Join" button');

    const selectors = [
      'button:has-text("Join")',
      'button#joinBtn',
      'input[type="button"][value*="Join" i]',
      'input[type="submit"][value*="Join" i]',
      '[role="button"]:has-text("Join")',
    ];

    for (const sel of selectors) {
      try {
        const btn = this._page.locator(sel).first();
        if ((await btn.count()) > 0 && (await btn.isVisible({ timeout: 5_000 }))) {
          await btn.click();
          this.log.info(`Clicked pre-join button via ${sel}`);
          await this._sleep(5_000); // meeting loads
          return;
        }
      } catch { /* try next */ }
    }

    // Fallback — press Enter which usually submits the name form
    this.log.warn('No visible Join button found — pressing Enter as fallback');
    await this._page.keyboard.press('Enter');
    await this._sleep(5_000);
  }

  /* ---------- D: "Join with Computer Audio" ---------------------- */

  async _clickJoinAudio() {
    this.log.info('Looking for "Join with Computer Audio" prompt');

    const selectors = [
      'button:has-text("Join Audio by Computer")',
      'button:has-text("Join with Computer Audio")',
      'button:has-text("Join Computer Audio")',
      'button:has-text("Join Audio")',
      'button:has-text("Computer Audio")',
      // Zoom web-client sometimes uses a generic class
      'button.join-audio-by-voip__join-btn',
      'button[class*="join-audio"]',
    ];

    // The audio dialog may take a moment to appear after gaining meeting access
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const sel of selectors) {
        try {
          const btn = this._page.locator(sel).first();
          if ((await btn.count()) > 0 && (await btn.isVisible({ timeout: 2_000 }))) {
            await btn.click();
            this.log.info(`Clicked audio join via ${sel}`);
            await this._sleep(2_000);
            return;
          }
        } catch { /* try next */ }
      }
      // Wait before retrying
      await this._sleep(3_000);
    }

    this.log.info('No computer-audio prompt appeared — may have auto-connected');
  }

  /* ---------- E: dismiss leftover overlays ----------------------- */

  async _dismissOverlays() {
    // Close cookie banners, tooltips, "Got it" dialogs, etc.
    const dismissSelectors = [
      'button:has-text("Got it")',
      'button:has-text("OK")',
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      'button[aria-label="Close"]',
      'button[aria-label="close"]',
      '.cookie-banner button',
    ];

    for (const sel of dismissSelectors) {
      try {
        const el = this._page.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible({ timeout: 1_000 }))) {
          await el.click();
          this.log.debug(`Dismissed overlay via ${sel}`);
          await this._sleep(300);
        }
      } catch { /* ignore */ }
    }
  }

  /* (media controls and old join methods removed — handled by _handleZoomWebClientFlow) */

  async _checkIfJoined() {
    try {
      return await this._page.evaluate(() => {
        // Look for indicators that we're actually in a meeting
        return !!(
          document.querySelector('[data-tooltip*="mute"]') ||
          document.querySelector('[aria-label*="mute"]') ||
          document.querySelector('button:has-text("Mute")') ||
          document.querySelector('button:has-text("Stop Video")') ||
          document.querySelector('.video-container') ||
          document.querySelector('[data-tooltip*="participants"]') ||
          document.querySelector('.participants-count')
        );
      });
    } catch {
      return false;
    }
  }

  async _checkMeetingEndedText() {
    return this._page.evaluate(() => {
      const body = document.body ? document.body.innerText : '';
      const lowered = body.toLowerCase();
      const title = document.title ? document.title.toLowerCase() : '';
      return (
        lowered.includes('meeting has been ended') ||
        lowered.includes('meeting has ended') ||
        lowered.includes('has been ended by host') ||
        lowered.includes('you have left') ||
        lowered.includes('meeting ended') ||
        lowered.includes('thank you for joining') ||
        lowered.includes('this meeting has been ended') ||
        lowered.includes('this meeting id is not valid') ||
        lowered.includes('meeting does not exist') ||
        lowered.includes('this meeting is not available') ||
        lowered.includes('invalid meeting id') ||
        title.includes('error')
      );
    }).catch(() => false);
  }

  /**
   * Click the "OK" button on the "This meeting has been ended by host" dialog,
   * then wait a moment for the page to settle before leaving.
   */
  async _clickMeetingEndedOk() {
    const okSelectors = [
      'button:has-text("OK")',
      'button:has-text("Ok")',
      'button:has-text("ok")',
      'button.zm-btn--primary:has-text("OK")',
      '[role="button"]:has-text("OK")',
      'button[type="button"]:has-text("OK")',
    ];

    for (const sel of okSelectors) {
      try {
        const btn = this._page.locator(sel).first();
        if ((await btn.count()) > 0 && (await btn.isVisible({ timeout: 2_000 }))) {
          await btn.click();
          this.log.info(`Clicked meeting-ended OK button via ${sel}`);
          await this._sleep(1_500);
          return;
        }
      } catch { /* try next */ }
    }
    this.log.debug('No OK button found on meeting-ended dialog');
  }

  /**
   * Close any extra tabs that may have been opened during navigation,
   * keeping only the current main page.
   */
  async _closeExtraTabs() {
    try {
      const allPages = this._context.pages();
      for (const p of allPages) {
        if (p !== this._page && !p.isClosed()) {
          this.log.info('Closing extra tab', { url: p.url() });
          await p.close();
        }
      }
    } catch (err) {
      this.log.debug('Error closing extra tabs', { error: err.message });
    }
  }

  /** @param {number} ms */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ------------------------------------------------------------------ */
  /*  Zoom API helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Extract numeric meeting ID from a Zoom URL.
   * e.g. https://us05web.zoom.us/j/1234567890?pwd=abc → "1234567890"
   */
  _extractMeetingId(url) {
    // Try several common Zoom URL patterns
    const patterns = [/\/j\/(\d+)/, /\/wc\/(\d+)/, /\/meeting\/(\d+)/, /(\d{9,12})/];
    for (const rx of patterns) {
      const m = url.match(rx);
      if (m && m[1]) return m[1];
    }

    throw new Error(`Could not extract Zoom meeting ID from URL: ${url}`);
  }

  /**
   * Obtain an access token using Server-to-Server OAuth.
   * @see https://developers.zoom.us/docs/internal-apps/s2s-oauth/
   */
  async _authenticate() {
    const clientId = process.env.ZOOM_API_KEY;
    const clientSecret = process.env.ZOOM_API_SECRET;
    const accountId = process.env.ZOOM_ACCOUNT_ID;

    if (!clientId || !clientSecret || !accountId) {
      throw new Error(
        'Missing Zoom credentials. Set ZOOM_API_KEY, ZOOM_API_SECRET, and ZOOM_ACCOUNT_ID.'
      );
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=account_credentials&account_id=${accountId}`,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zoom OAuth failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  /**
   * Fetch meeting details.
   * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meeting
   */
  async _getMeetingDetails(meetingId) {
    const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      headers: { Authorization: `Bearer ${this._accessToken}` },
    });
    if (!res.ok) {
      const err = new Error(`Zoom API error (${res.status})`);
      err.statusCode = res.status;
      throw err;
    }
    return res.json();
  }

  /**
   * Poll live meeting status.
   * Returns "started", "ended", or "waiting".
   */
  async _getMeetingStatus(meetingId) {
    const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      headers: { Authorization: `Bearer ${this._accessToken}` },
    });

    if (!res.ok) {
      const err = new Error(`Zoom API error (${res.status})`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    return data.status; // "waiting" | "started" | "ended"
  }

  /** Start cloud recording via Zoom Live Meeting API. */
  async _startCloudRecording(meetingId) {
    const res = await fetch(
      `https://api.zoom.us/v2/live_meetings/${meetingId}/events`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this._accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'recording.start' }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to start Zoom cloud recording (${res.status}): ${text}`);
    }
  }

  /** Stop cloud recording via Zoom Live Meeting API. */
  async _stopCloudRecording(meetingId) {
    const res = await fetch(
      `https://api.zoom.us/v2/live_meetings/${meetingId}/events`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this._accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method: 'recording.stop' }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to stop Zoom cloud recording (${res.status}): ${text}`);
    }
  }
}

module.exports = ZoomAdapter;
