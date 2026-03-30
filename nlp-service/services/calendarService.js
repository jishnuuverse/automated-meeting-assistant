/**
 * Google Calendar service using googleapis
 * - Creates calendar events for action items that include a calendar_event_date
 * - Supports relative date parsing via chrono-node (e.g. "next Monday", "in two weeks")
 */
const { google } = require('googleapis');
const chrono = require('chrono-node');
const {
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CALENDAR_ID,
} = require('../config');
const { withRetry } = require('./retry');

// Fix private key newlines — .env files often store \n as literal two-char sequences
const privateKey = GOOGLE_PRIVATE_KEY ? GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

if (!GOOGLE_CLIENT_EMAIL || !privateKey || !GOOGLE_CALENDAR_ID) {
  console.warn('[Calendar] Google Calendar credentials incomplete. Set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_CALENDAR_ID.');
} else {
  console.log('[Calendar] Auth config loaded — email:', GOOGLE_CLIENT_EMAIL, '| calendarId:', GOOGLE_CALENDAR_ID);
}

// Create a JWT auth client using a service account
const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: privateKey,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

console.log('[Calendar] JWT auth client created');

const calendar = google.calendar({ version: 'v3', auth });

/**
 * Try to parse a date string using chrono-node for relative/natural language dates.
 * Falls back to native Date parsing for already-formatted dates.
 * @param {string} rawDate
 * @returns {{ parsed: Date|null, hasTime: boolean, original: string }}
 */
function parseDate(rawDate) {
  if (!rawDate) return { parsed: null, hasTime: false, original: rawDate };

  const referenceDate = new Date();

  // 1. Try native Date first for already-formatted dates (e.g. "March 15, 2026", ISO, etc.)
  const nativeParsed = new Date(rawDate);
  const nativeOk = !isNaN(nativeParsed.getTime());
  const hasExplicitTime = /T|:\d{2}/.test(rawDate) || (nativeOk && (nativeParsed.getHours() !== 0 || nativeParsed.getMinutes() !== 0));

  if (nativeOk) {
    return { parsed: nativeParsed, hasTime: hasExplicitTime, original: rawDate };
  }

  // 2. Use chrono-node for relative / natural language dates
  const chronoResults = chrono.parse(rawDate, referenceDate);
  if (chronoResults.length > 0) {
    const result = chronoResults[0];
    const chronoDate = result.start.date();
    // chrono sets isCertain('hour') when a specific time was mentioned
    const chronoHasTime = result.start.isCertain('hour');
    return { parsed: chronoDate, hasTime: chronoHasTime, original: rawDate };
  }

  return { parsed: null, hasTime: false, original: rawDate };
}

/**
 * Helper to format a date into start/end for Google Calendar.
 * If a time is provided, creates a 1-hour event. If only date provided, creates an all-day event.
 * @param {Date} dateObj
 * @param {boolean} hasTime
 * @returns {{start:Object, end:Object}|null}
 */
function buildEventTimes(dateObj, hasTime) {
  if (!dateObj || isNaN(dateObj.getTime())) return null;

  if (hasTime) {
    const start = dateObj.toISOString();
    const end = new Date(dateObj.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour
    return { start: { dateTime: start }, end: { dateTime: end } };
  }

  // All-day event using date only (YYYY-MM-DD)
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');
  const startDate = `${yyyy}-${mm}-${dd}`;
  // Google Calendar all-day events are exclusive of the end day
  const next = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate() + 1));
  const yyyy2 = next.getUTCFullYear();
  const mm2 = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd2 = String(next.getUTCDate()).padStart(2, '0');
  const endDate = `${yyyy2}-${mm2}-${dd2}`;
  return { start: { date: startDate }, end: { date: endDate } };
}

/**
 * Create a Google Calendar event for an action item.
 * Supports both formatted dates and relative/natural language dates via chrono-node.
 * @param {Object} item
 * @returns {Object} - creation result
 */
async function createCalendarEvent(item = {}) {
  const { 
  calendar_event_title, 
  calendar_event_date,
  task,
  deadline 
} = item;

const eventTitle = calendar_event_title || task || 'Meeting action item';
const eventDate = calendar_event_date || deadline;
  console.log('[Calendar] createCalendarEvent called with:', JSON.stringify(item));

  if (!eventDate) {
    return { success: false, error: 'calendar_event_date missing' };
}

  // Parse the date (supports relative dates like "next Monday", "in two weeks", "by Friday")
  const { parsed, hasTime, original } = parseDate(eventDate);
  console.log('[Calendar] Date parsed:', { original, parsed: parsed?.toISOString?.() || null, hasTime });

  if (!parsed) {
    console.warn(`[Calendar] Skipping: "${calendar_event_date}" — not a valid future date`);
    return { success: false, error: `Could not parse date: "${calendar_event_date}"` };
  }

  // Skip dates in the past
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (parsed < now) {
    console.info(`[Calendar] Skipping: "${calendar_event_date}" — not a valid future date (parsed to ${parsed.toISOString().slice(0, 10)} which is in the past)`);
    return { success: false, error: `Parsed date is in the past: "${calendar_event_date}" → ${parsed.toISOString().slice(0, 10)}` };
  }

  const times = buildEventTimes(parsed, hasTime);
  if (!times) {
    console.warn(`[Calendar] Skipping: "${calendar_event_date}" — not a valid future date (buildEventTimes failed)`);
    return { success: false, error: 'Invalid calendar_event_date' };
  }

  const event = {
    summary: eventTitle,
    description: `Original deadline: "${original}"`,
    ...times,
  };

  try {
    console.log('[Calendar] Creating event:', JSON.stringify(event));
    const response = await withRetry(
      () => calendar.events.insert({
        calendarId: GOOGLE_CALENDAR_ID,
        requestBody: event,
      }),
      3,   // maxRetries
      1000 // baseDelayMs → 1s, 2s, 4s
    );
    console.log('[Calendar] Event created successfully:', response.data?.id);
    return { success: true, event: response.data, retry_attempts: response.retry_attempts || 1 };
  } catch (error) {
    console.error('[Calendar] Event creation failed:', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status || error?.code,
      responseData: error?.response?.data,
    });
    const status = error?.response?.status || error?.code;
    const detail = error?.response?.data?.error?.message || error.message || String(error);
    if (status === 404) {
      return {
        success: false,
        error: `Calendar not found or not shared with service account. Share your calendar (${GOOGLE_CALENDAR_ID}) with ${GOOGLE_CLIENT_EMAIL} and grant "Make changes to events" permission.`,
        retry_attempts: error?.retry_attempts || 0,
      };
    }
    return { success: false, error: detail, retry_attempts: error?.retry_attempts || 0 };
  }
}

module.exports = {
  createCalendarEvent,
};
