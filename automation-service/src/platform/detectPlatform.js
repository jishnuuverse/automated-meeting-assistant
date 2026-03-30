'use strict';

/**
 * Detect the meeting platform from a meeting URL.
 *
 * @param {string} meetingUrl - The full meeting URL.
 * @returns {'google' | 'zoom' | 'teams'} The detected platform identifier.
 * @throws {Error} If the URL does not match any supported platform.
 */
function detectPlatform(meetingUrl) {
  if (!meetingUrl || typeof meetingUrl !== 'string') {
    throw new Error('meetingUrl must be a non-empty string');
  }

  const url = meetingUrl.toLowerCase().trim();

  if (url.includes('meet.google.com')) return 'google';
  if (url.includes('zoom.us')) return 'zoom';
  if (url.includes('teams.microsoft.com')) return 'teams';

  throw new Error(
    `Unsupported meeting platform. URL must contain meet.google.com, zoom.us, or teams.microsoft.com. Received: ${meetingUrl}`
  );
}

/**
 * Check whether a URL belongs to a supported platform (non-throwing).
 *
 * @param {string} meetingUrl
 * @returns {boolean}
 */
function isSupportedPlatform(meetingUrl) {
  try {
    detectPlatform(meetingUrl);
    return true;
  } catch {
    return false;
  }
}

module.exports = { detectPlatform, isSupportedPlatform };
