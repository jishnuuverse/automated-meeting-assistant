/**
 * Express route — Meeting-Level Notion Storage
 *
 * POST /notion  { meeting_date, summary, action_items }
 * Creates ONE page in the Meetings database with summary text
 * and a tasks/deadlines table.
 */
const express = require('express');
const router = express.Router();
const { createMeetingPage } = require('../services/notionService');

router.post('/', async (req, res) => {
  try {
    const { meeting_date, summary, action_items } = req.body || {};

    if (!meeting_date) {
      return res.status(400).json({ success: false, error: 'meeting_date is required.' });
    }
    if (typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ success: false, error: 'summary is required and must be a non-empty string.' });
    }

    const result = await createMeetingPage({
      meeting_date,
      summary,
      action_items: Array.isArray(action_items) ? action_items : [],
    });

    const status = result.success ? 200 : 422;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
});

module.exports = router;
