'use strict';

const { detectPlatform } = require('./detectPlatform');
const GoogleMeetAdapter = require('./GoogleMeetAdapter');
const ZoomAdapter = require('./ZoomAdapter');
const TeamsAdapter = require('./TeamsAdapter');

/**
 * Registry mapping platform identifiers → adapter constructors.
 * Add new platforms here.
 */
const ADAPTER_MAP = {
  google: GoogleMeetAdapter,
  zoom: ZoomAdapter,
  teams: TeamsAdapter,
};

/**
 * Create the correct adapter for a meeting URL.
 *
 * @param {string} meetingUrl - The full meeting URL.
 * @returns {import('./BaseAdapter')} An adapter instance ready for `.run()`.
 * @throws {Error} If the platform is unsupported.
 */
function createAdapter(meetingUrl) {
  const platform = detectPlatform(meetingUrl);
  const AdapterClass = ADAPTER_MAP[platform];

  if (!AdapterClass) {
    throw new Error(`No adapter registered for platform "${platform}".`);
  }

  return new AdapterClass();
}

module.exports = { createAdapter, ADAPTER_MAP };
