'use strict';

const BaseAdapter = require('./BaseAdapter');
const Recorder = require('../utils/recorder');

/**
 * Microsoft Teams adapter using the Microsoft Graph API.
 *
 * This adapter communicates with the Graph API to:
 *   - Access a Teams meeting (online meeting resource)
 *   - Monitor meeting status (call records / presence)
 *   - Handle recording lifecycle
 *   - Detect meeting end and perform clean exit
 *
 * Required environment variables:
 *   MS_TENANT_ID      – Azure AD tenant ID
 *   MS_CLIENT_ID      – Azure AD app (client) ID
 *   MS_CLIENT_SECRET   – Azure AD client secret
 *
 * Permissions required (Application):
 *   OnlineMeetings.Read.All
 *   CallRecords.Read.All
 *   Communications.ReadWrite.All  (if starting recording via Graph)
 *
 * NOTE: Graph API does not natively support "joining" a meeting as a bot
 *       without the Communications Calling SDK.  This adapter provides
 *       the scaffolding; deploy with the Azure Communications Bot or
 *       use the local FFmpeg recorder when paired with a browser join.
 */
class TeamsAdapter extends BaseAdapter {
  constructor() {
    super('teams');
    this._recorder = new Recorder();
    this._meetingId = null;
    this._onlineMeetingId = null;
    this._accessToken = null;
    this._pollInterval = null;
  }

  /* ------------------------------------------------------------------ */
  /*  join()                                                             */
  /* ------------------------------------------------------------------ */

  async join(options) {
    const { url } = options;

    this._meetingId = `meeting-${Date.now()}`;
    this._onlineMeetingId = this._extractMeetingId(url);

    this.log.info('Connecting to Teams meeting via Microsoft Graph API', {
      onlineMeetingId: this._onlineMeetingId,
    });

    // 1. Authenticate with Azure AD (client-credentials flow)
    this._accessToken = await this._authenticate();
    this.log.info('Microsoft Graph API authenticated');

    // 2. Verify meeting exists and retrieve details
    const meetingDetails = await this._getMeetingDetails(this._onlineMeetingId);
    this.log.info('Meeting details fetched', {
      subject: meetingDetails.subject,
    });

    // 3. Start local recording (Graph cloud recording requires Calling SDK bot)
    this._recorder.start(this._meetingId);
    this.log.info('Local FFmpeg recording started');
  }

  /* ------------------------------------------------------------------ */
  /*  monitor()                                                          */
  /* ------------------------------------------------------------------ */

  async monitor() {
    this.log.info('Monitoring Teams meeting status via Graph API polling');

    return new Promise((resolve) => {
      this._pollInterval = setInterval(async () => {
        try {
          const isActive = await this._isMeetingActive(this._onlineMeetingId);
          this.log.debug('Teams meeting poll', { isActive });

          if (!isActive) {
            this.log.info('Meeting end detected via Graph API');
            clearInterval(this._pollInterval);
            this._pollInterval = null;
            resolve();
          }
        } catch (err) {
          if (err.statusCode === 404 || err.status === 404) {
            this.log.info('Meeting end detected: resource no longer exists');
            clearInterval(this._pollInterval);
            this._pollInterval = null;
            resolve();
          } else {
            this.log.warn('Teams status poll error', { error: err.message });
          }
        }
      }, 15_000); // Poll every 15 s
    });
  }

  /* ------------------------------------------------------------------ */
  /*  leave()                                                            */
  /* ------------------------------------------------------------------ */

  async leave() {
    if (this._disposed) return;
    this._markDisposed();

    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    // Stop recording
    await this._recorder.stop('meeting ended');
    this.log.info('Recording stopped');

    this.log.info('Teams adapter resources released');
  }

  /* ------------------------------------------------------------------ */
  /*  Microsoft Graph helpers                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Extract the meeting thread / join ID from a Teams meeting URL.
   * Teams URLs look like:
   *   https://teams.microsoft.com/l/meetup-join/19%3ameeting_...
   */
  _extractMeetingId(url) {
    // Try to get the meeting thread ID from the URL path
    const match = url.match(/meetup-join\/([^/&?]+)/);
    if (match) return decodeURIComponent(match[1]);

    // Fallback: use the full URL as a join identifier (Graph can accept joinWebUrl)
    return url;
  }

  /**
   * Obtain an access token using the Azure AD client-credentials flow.
   * @see https://learn.microsoft.com/en-us/graph/auth-v2-service
   */
  async _authenticate() {
    const tenantId = process.env.MS_TENANT_ID;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Missing Microsoft credentials. Set MS_TENANT_ID, MS_CLIENT_ID, and MS_CLIENT_SECRET.'
      );
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure AD token request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  /**
   * Fetch online meeting details from Graph.
   * Uses the joinWebUrl filter to locate the meeting resource.
   * @see https://learn.microsoft.com/en-us/graph/api/onlinemeeting-get
   */
  async _getMeetingDetails(meetingIdOrUrl) {
    // If the identifier looks like a URL, search by joinWebUrl
    const isUrl = meetingIdOrUrl.startsWith('http');
    const endpoint = isUrl
      ? `https://graph.microsoft.com/v1.0/communications/onlineMeetings?$filter=joinWebUrl eq '${encodeURIComponent(meetingIdOrUrl)}'`
      : `https://graph.microsoft.com/v1.0/communications/onlineMeetings/${meetingIdOrUrl}`;

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${this._accessToken}` },
    });

    if (!res.ok) {
      const err = new Error(`Graph API error (${res.status})`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    // Filter response returns { value: [...] }
    return data.value ? data.value[0] : data;
  }

  /**
   * Determine whether the meeting is still active.
   * Uses call records or online meeting presence as a proxy.
   */
  async _isMeetingActive(meetingIdOrUrl) {
    try {
      const details = await this._getMeetingDetails(meetingIdOrUrl);
      // If we can still retrieve the meeting and it hasn't been explicitly ended,
      // treat it as active.  A 404 means it's gone.
      return !!details;
    } catch (err) {
      if (err.statusCode === 404) return false;
      throw err;
    }
  }
}

module.exports = TeamsAdapter;
