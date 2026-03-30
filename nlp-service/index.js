require('dotenv').config();
const express = require('express');
const chrono = require('chrono-node');
const { summarizeTranscript } = require('./summarizer');
const notionRoutes = require('./routes/notion');
const calendarRoutes = require('./routes/calendar');
const { createMeetingPage } = require('./services/notionService');
const { createCalendarEvent } = require('./services/calendarService');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(express.json());

// health
app.get('/', (req, res) => res.json({ success: true, service: 'nlp-service' }));

/**
 * After summarization, push meeting summary to Notion and
 * action item deadlines to Google Calendar.
 * Runs in the background — failures are logged but do not
 * affect the summarization response.
 */
async function pushToIntegrations(result) {
	const integrationResults = { notion: null, calendar: [] };

	// ── Push ONE meeting page to Notion (summary + action items table) ──
	if (result.summary && typeof result.summary === 'string' && result.summary.trim()) {
		try {
			const today = new Date().toISOString().slice(0, 10);
			const notionResult = await createMeetingPage({
				meeting_date: result.meeting_date || today,
				summary: result.summary,
				action_items: result.action_items || [],
			});
			integrationResults.notion = notionResult;
			console.info('[Integration] Notion push result:', JSON.stringify(notionResult));
		} catch (err) {
			console.warn('[Integration] Notion push failed:', err?.message || err);
		}
	}

	// ── Push action item deadlines to Google Calendar (only upcoming dates) ──
	if (Array.isArray(result.action_items)) {
		// Start of today (midnight) — deadlines on or after today are considered upcoming
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		for (const item of result.action_items) {
			if (item.deadline) {
				// Parse the deadline — try native Date first, then handle "this [weekday]" special case
				let deadlineDate = new Date(item.deadline);
				if (isNaN(deadlineDate.getTime())) {
					// Handle "this [weekday]" when it matches today's weekday
					const today = new Date();
					const todayWeekday = today.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
					const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
					const todayWeekdayName = weekdayNames[todayWeekday];
					
					const thisWeekdayPattern = new RegExp(`\\bthis\\s+(${weekdayNames.join('|')})\\b`, 'i');
					const match = item.deadline.match(thisWeekdayPattern);
					
					if (match && match[1].toLowerCase() === todayWeekdayName) {
						// "this Thursday" and today is Thursday → use today's date
						deadlineDate = new Date(today);
						console.info(`[Integration] "this ${match[1]}" matches today (${todayWeekdayName}) → using today's date`);
					} else {
						// Try chrono-node for other relative dates like "next Monday", "in two weeks"
						deadlineDate = chrono.parseDate(item.deadline, new Date());
					}
				}
				if (!deadlineDate || isNaN(deadlineDate.getTime())) {
					console.warn(`[Integration] Skipping unparseable deadline: "${item.deadline}"`);
					continue;
				}
				if (deadlineDate < todayStart) {
					console.info(`[Integration] Skipping past deadline: "${item.deadline}" (before ${todayStart.toISOString().slice(0, 10)})`);
					continue;
				}

				try {
					const calResult = await createCalendarEvent({
						calendar_event_title: item.task || 'Action item deadline',
						calendar_event_date: item.deadline,
					});
					integrationResults.calendar.push(calResult);
					console.info('[Integration] Calendar event created for upcoming deadline:', item.deadline, calResult);
				} catch (err) {
					console.warn(`[Integration] Calendar push failed for deadline "${item.deadline}":`, err?.message || err);
				}
			}
		}
	}

	return integrationResults;
}

app.post('/summarize', async (req, res) => {
	try {
		const { transcript, processing_mode } = req.body || {};
		const effectiveMode = processing_mode || 'cloud';
		console.info('[NLP] /summarize called with processing_mode=%s', effectiveMode);

		if (typeof transcript !== 'string' || !transcript.trim()) {
			return res.status(400).json({
				success: false,
				error: 'transcript is required and must be a non-empty string.',
			});
		}

		const result = await summarizeTranscript(transcript, effectiveMode);

		// Fire integration push in the background (don't block the response)
		pushToIntegrations(result).catch((err) =>
			console.warn('[Integration] Background push failed:', err?.message || err)
		);

		return res.status(200).json({
			success: true,
			result,
		});
	} catch (error) {
		return res.status(500).json({
			success: false,
			error: error?.message || 'Failed to summarize transcript.',
		});
	}
});

/**
 * POST /integrations/ingest
 * Accepts a pre-built summary result and triggers Notion + Calendar push.
 * Used by the hybrid stt-service orchestrator so integrations fire
 * regardless of which pipeline produced the summary.
 */
app.post('/integrations/ingest', async (req, res) => {
	try {
		const result = req.body || {};

		if (!result.summary && !result.action_items) {
			return res.status(400).json({
				success: false,
				error: 'Request body must contain summary or action_items.',
			});
		}

		console.info('[Integration] Ingest received — pushing to Notion + Calendar…');

		// Fire in background, respond immediately
		pushToIntegrations(result).catch((err) =>
			console.warn('[Integration] Background push failed:', err?.message || err)
		);

		return res.status(200).json({ success: true });
	} catch (error) {
		console.error('[Integration] Ingest error:', error?.message || error);
		return res.status(500).json({
			success: false,
			error: error?.message || 'Integration ingest failed.',
		});
	}
});

// Register Notion and Calendar routes
app.use('/notion', notionRoutes);
app.use('/calendar', calendarRoutes);

app.listen(PORT, () => {
	console.log(`NLP service running on port ${PORT}`);
});
