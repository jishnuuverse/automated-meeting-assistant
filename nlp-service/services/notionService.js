/**
 * Notion Service — Meeting-Level Storage
 *
 * Creates ONE page per meeting in the "Meetings" database with:
 *   - Title       : "Meeting - YYYY-MM-DD"
 *   - Meeting Date: validated ISO date
 *   - Page body   :
 *       1. "Summary" heading
 *       2. Summary text paragraphs
 *       3. "Tasks & Deadlines" heading
 *       4. Table with two columns: Task | Deadline
 */
const { Client } = require('@notionhq/client');
const { NOTION_API_KEY, NOTION_DATABASE_ID } = require('../config');
const { withRetry } = require('./retry');

// ── Config validation (logged once at startup) ──
const hasNotionConfig = Boolean(NOTION_API_KEY && NOTION_DATABASE_ID);
if (!hasNotionConfig) {
  console.warn('[NotionService] NOTION_API_KEY and NOTION_DATABASE_ID must both be set.');
}

const notion = hasNotionConfig ? new Client({ auth: NOTION_API_KEY }) : null;

// ── Date helpers ──

/**
 * Return true when `s` is a real calendar date in YYYY-MM-DD form.
 */
function isValidISODate(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, yStr, mStr, dStr] = m;
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Convert a date string to ISO YYYY-MM-DD.
 * Returns null when the value is unparseable.
 */
function formatDateToISO(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const t = dateStr.trim();
  if (!t) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && isValidISODate(t)) return t;

  // Try native Date parse (covers ISO-8601 with time, etc.)
  const parsed = new Date(t);
  if (!isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10);
    if (isValidISODate(iso)) return iso;
  }

  // MM/DD/YYYY or DD-MM-YYYY variants
  const m = t.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (m) {
    const a = m[1].padStart(2, '0');
    const b = m[2].padStart(2, '0');
    const y = m[3];
    const try1 = `${y}-${a}-${b}`;
    if (isValidISODate(try1)) return try1;
    const try2 = `${y}-${b}-${a}`;
    if (isValidISODate(try2)) return try2;
  }

  return null;
}

/**
 * Validate meeting_date:
 *  - Must parse to a valid ISO date.
 *  - Year must be >= currentYear - 1 (reject unrealistic years).
 * Returns { valid: true, iso } or { valid: false, reason }.
 */
function validateMeetingDate(raw) {
  const iso = formatDateToISO(raw);
  if (!iso) {
    return { valid: false, reason: `Invalid or unparseable date: "${raw}"` };
  }
  const year = Number(iso.slice(0, 4));
  const minYear = new Date().getFullYear() - 1;
  if (year < minYear) {
    return { valid: false, reason: `Year ${year} is unrealistic (minimum accepted: ${minYear})` };
  }
  return { valid: true, iso };
}

// ── Notion Rich Text chunking ──
// Notion caps each rich_text content block at 2 000 chars.
const NOTION_TEXT_LIMIT = 2000;

function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += NOTION_TEXT_LIMIT) {
    chunks.push(text.slice(i, i + NOTION_TEXT_LIMIT));
  }
  return chunks;
}

// ── Build page body blocks (summary text + tasks/deadlines table) ──

/**
 * Build Notion block children for the page body.
 * Layout:
 *   - Heading 2: "Summary"
 *   - Paragraph blocks with the summary text
 *   - Heading 2: "Tasks & Deadlines"
 *   - Table (2 columns): Task | Deadline
 */
function buildPageChildren(summaryText, actionItems) {
  const children = [];

  // ── Summary heading ──
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Summary' } }],
    },
  });

  // ── Summary paragraphs (chunked to stay within Notion limits) ──
  const summaryChunks = chunkText(summaryText);
  for (const chunk of summaryChunks) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: chunk } }],
      },
    });
  }

  // ── Divider ──
  children.push({ object: 'block', type: 'divider', divider: {} });

  // ── Tasks & Deadlines heading ──
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Tasks & Deadlines' } }],
    },
  });

  // ── Table: 2 columns (Task, Deadline) ──
  const tableRows = [];

  // Header row
  tableRows.push({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        [{ type: 'text', text: { content: 'Task' }, annotations: { bold: true } }],
        [{ type: 'text', text: { content: 'Deadline' }, annotations: { bold: true } }],
      ],
    },
  });

  // Data rows from action items
  const items = Array.isArray(actionItems) ? actionItems : [];
  if (items.length > 0) {
    for (const item of items) {
      const taskText = (item.task || '').trim() || '—';
      // BUG 2 fix: replace null/undefined/empty deadline with fallback text
      let deadlineText = (item.deadline || '').trim();
      if (!deadlineText) {
        deadlineText = 'No deadline mentioned';
      }
      tableRows.push({
        object: 'block',
        type: 'table_row',
        table_row: {
          cells: [
            [{ type: 'text', text: { content: taskText.slice(0, NOTION_TEXT_LIMIT) } }],
            [{ type: 'text', text: { content: deadlineText.slice(0, NOTION_TEXT_LIMIT) } }],
          ],
        },
      });
    }
  } else {
    // No action items — single row saying so
    tableRows.push({
      object: 'block',
      type: 'table_row',
      table_row: {
        cells: [
          [{ type: 'text', text: { content: 'No action items found' } }],
          [{ type: 'text', text: { content: '—' } }],
        ],
      },
    });
  }

  children.push({
    object: 'block',
    type: 'table',
    table: {
      table_width: 2,
      has_column_header: true,
      has_row_header: false,
      children: tableRows,
    },
  });

  return children;
}

// ── Core function ──

/**
 * Create ONE Notion page in the Meetings database.
 *
 * @param {object} params
 * @param {string} params.meeting_date   — any parseable date string
 * @param {string} params.summary        — full meeting summary
 * @param {Array}  params.action_items   — action items with task & deadline
 * @returns {{ success: boolean, pageId?: string, error?: string }}
 */
async function createMeetingPage({ meeting_date, summary, action_items } = {}) {
  // 1. Config check
  if (!hasNotionConfig || !notion) {
    return { success: false, error: 'Notion credentials not configured. Set NOTION_API_KEY and NOTION_DATABASE_ID.' };
  }

  // 2. Date validation
  if (!meeting_date) {
    return { success: false, error: 'meeting_date is required.' };
  }
  const dateResult = validateMeetingDate(meeting_date);
  if (!dateResult.valid) {
    return { success: false, error: dateResult.reason };
  }

  // 3. Summary validation
  if (typeof summary !== 'string' || !summary.trim()) {
    return { success: false, error: 'summary is required and must be a non-empty string.' };
  }

  const isoDate = dateResult.iso;
  const title = `Meeting - ${isoDate}`;
  const fullSummary = summary.trim();

  // 4. Build page body: summary text + tasks/deadlines table
  const children = buildPageChildren(fullSummary, action_items);

  // 5. Build Notion payload
  const payload = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Name: { title: [{ text: { content: title } }] },
      'Meeting Date': { date: { start: isoDate } },
    },
    children,
  };

  // 6. Create the page (with retry for transient/5xx errors)
  try {
    const response = await withRetry(
      () => notion.pages.create(payload),
      3,   // maxRetries
      1000 // baseDelayMs → 1s, 2s, 4s
    );
    console.info(`[NotionService] Page created: "${title}" (${response.id}) | retries=${response.retry_attempts || 1}`);
    return { success: true, pageId: response.id, retry_attempts: response.retry_attempts || 1 };
  } catch (err) {
    console.error('[NotionService] Page creation failed:', err?.message);
    return { success: false, error: err?.message || 'Notion API error', retry_attempts: err?.retry_attempts || 0 };
  }
}

module.exports = {
  createMeetingPage,
  formatDateToISO,
  validateMeetingDate,
};