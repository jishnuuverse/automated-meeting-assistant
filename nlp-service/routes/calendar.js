/**
 * Express route to create Google Calendar events for action items.
 * Accepts action items with either:
 *   - { task, deadline }              ← from LLM output
 *   - { calendar_event_title, calendar_event_date }  ← explicit format
 * Only upcoming (today or future) deadlines are added to the calendar.
 */
const express = require('express');
const router = express.Router();
const chrono = require('chrono-node');
const { createCalendarEvent } = require('../services/calendarService');

// ── Helper: normalize an action item to the shape calendarService expects ──
function normalizeItem(item) {
  if (!item) return null;

  // Accept both field name conventions
  const title = item.calendar_event_title || item.task || 'Meeting action item';
  const rawDate = item.calendar_event_date || item.deadline || null;

  return { calendar_event_title: title, calendar_event_date: rawDate, _original: item };
}

// ── Helper: check if a raw date string resolves to a future date ──
function isFutureDate(rawDate) {
  if (!rawDate) return false;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Try native Date first
  const native = new Date(rawDate);
  if (!isNaN(native.getTime())) return native >= todayStart;

  // Try chrono-node for relative dates like "next Monday", "by Friday"
  const chronoResult = chrono.parseDate(rawDate, new Date());
  if (chronoResult) return chronoResult >= todayStart;

  return false;
}

// ────────────────────────────────────────────────────────────────
// GET /calendar/test
// Creates a single hardcoded test event to verify auth is working
// ────────────────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  try {
    console.log('[Calendar/Test] Creating hardcoded test event to verify auth...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isoDate = tomorrow.toISOString().slice(0, 10);

    const result = await createCalendarEvent({
      calendar_event_title: 'Calendar Auth Test Event',
      calendar_event_date: isoDate,
    });

    console.log('[Calendar/Test] Result:', JSON.stringify(result));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('[Calendar/Test] Error:', { message: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ────────────────────────────────────────────────────────────────
// POST /calendar  { action_items: [ ... ] }
// Accepts: { task, deadline }  OR  { calendar_event_title, calendar_event_date }
// ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { action_items } = req.body || {};

    if (!Array.isArray(action_items)) {
      return res.status(400).json({ success: false, error: 'action_items must be an array' });
    }

    const results = [];

    for (const raw of action_items) {
      // Normalize field names
      const item = normalizeItem(raw);

      if (!item) {
        results.push({ success: false, error: 'Invalid item', item: raw });
        continue;
      }

      // Check date exists
      if (!item.calendar_event_date) {
        console.warn('[Calendar] Skipping item — no deadline or calendar_event_date:', raw);
        results.push({ success: false, error: 'No deadline provided', item: raw });
        continue;
      }

      // Check date is in the future (supports relative dates via chrono-node)
      if (!isFutureDate(item.calendar_event_date)) {
        console.info(`[Calendar] Skipping — past or unparseable date: "${item.calendar_event_date}"`);
        results.push({
          success: false,
          error: `Past or unparseable date skipped: "${item.calendar_event_date}"`,
          item: raw,
        });
        continue;
      }

      // Create the event
      try {
        const created = await createCalendarEvent(item);
        results.push(created);
      } catch (err) {
        console.error('[Calendar] createCalendarEvent threw:', err?.message);
        results.push({ success: false, error: err?.message || String(err) });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('[Calendar] Route error:', error?.message);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to create calendar events',
    });
  }
});

module.exports = router;