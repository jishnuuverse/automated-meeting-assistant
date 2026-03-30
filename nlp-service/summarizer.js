// ── Always load nlp-service .env so Groq credentials are available ──
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const chrono = require('chrono-node');
const http = require('http');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = 'phi';
const REQUEST_TIMEOUT_MS = 300000;
const MIN_TRANSCRIPT_LENGTH = 50; // characters

// ── Map-reduce thresholds ──
const MAP_REDUCE_WORD_THRESHOLD = 3000;
const CHUNK_SIZE_WORDS = 800;
const CHUNK_OVERLAP_WORDS = 100;
const PER_CHUNK_TIMEOUT_MS = 240_000; // 4 min per chunk

const Groq = require('groq-sdk');
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Lazy Groq client — created on first use so env vars are always available
let _groqClient = null;
let _groqClientInitialized = false;
function getGroqClient() {
  if (!_groqClientInitialized) {
    _groqClientInitialized = true;
    if (process.env.GROQ_API_KEY) {
      _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
      console.info('[NLP] Groq client initialized with model:', GROQ_MODEL);
    } else {
      console.warn('[NLP] GROQ_API_KEY not set — Groq unavailable, will use Ollama');
    }
  }
  return _groqClient;
}

function preprocessTranscript(text) {
	if (typeof text !== 'string') return '';
	// Normalize whitespace
	let out = text.replace(/\s+/g, ' ').trim();
	// Remove repeated adjacent words (e.g., "the the" -> "the")
	out = out.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
	// Normalize multiple punctuation/space patterns left by speech errors
	out = out.replace(/\s+([?.!,;:])/g, '$1');
	return out;
}

function buildPrompt(transcriptText) {
	return `You are a meeting transcript processor. Analyze the transcript below and return ONLY valid JSON following the EXACT output rules.

EXTRACTION RULES:
1. cleaned_transcript: Full transcript with grammar and punctuation corrected. Preserve all original content, speaker labels, and meaning. Do not remove, summarize, or paraphrase any part.
2. summary: Write a DETAILED and COMPREHENSIVE summary in clear paragraphs (at least 150 words, up to 300 words). The first paragraph should state the meeting purpose, main topics, and key decisions. The second paragraph should describe each discussion point in detail. The third paragraph should mention any follow-up plans. Do NOT truncate or shorten the summary.
3. action_items: Extract EVERY task, action item, scheduled work, milestone, or request mentioned in the transcript. Be thorough — do not miss any. Apply these rules strictly:
   - task: Each task must be a SHORT concise action item of maximum 10 words. Format: [Person] - [action verb] [what]. Example: 'John - deliver design assets', 'Mike - confirm launch readiness', 'Alex - submit cloud proposal'. Do NOT copy full sentences from the transcript.
   - responsible: Name of the person or team responsible, exactly as mentioned. Use "" if not mentioned or ambiguous.
   - deadline: For each action item, you MUST extract a deadline if one is mentioned anywhere in the transcript for that task. If a relative date is used (e.g., "next Monday", "by Thursday", "this Friday"), convert it to an absolute date like "March 10, 2026". Today's date is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. If no deadline is mentioned for a task, write "No deadline mentioned". Never return null or empty string for deadline.
   - CRITICAL: A deadline must NEVER appear without a task. But if a task has a date mentioned with it (e.g., "complete X by March 5" or "X is scheduled for March 1" or "X by next Monday"), that date IS the deadline for that task — you MUST resolve it to an actual date and include it. Do NOT leave it blank.

OUTPUT RULES:
- Return ONLY valid JSON. No markdown, no code fences, no explanations.
- Do not invent or assume any task, deadline, or responsible person not explicitly stated.
- If no action items exist, return "action_items": [].
- Do NOT include an "important_dates" field.

OUTPUT FORMAT:
{"cleaned_transcript": "","summary": "","action_items": [{"task": "","responsible": "","deadline": ""}]}

Transcript:
"""${transcriptText}"""`;
}

function parseModelJson(rawText) {
	if (typeof rawText !== 'string' || !rawText.trim()) {
		throw new Error('Model returned an empty response.');
	}

	const trimmed = rawText.trim();

	try {
		return JSON.parse(trimmed);
	} catch (_err) {
		const firstBrace = trimmed.indexOf('{');
		const lastBrace = trimmed.lastIndexOf('}');
		if (firstBrace >= 0 && lastBrace > firstBrace) {
			const candidate = trimmed.slice(firstBrace, lastBrace + 1);
			return JSON.parse(candidate);
		}
		throw new Error('Model response was not valid JSON.');
	}
}

/**
 * Regex-based fallback: extract dates from transcript text.
 * Catches patterns like "February 26, 2026", "March 1, 2026", "Feb 29, 2026", "2026-03-05", etc.
 */
function extractDatesFromText(text) {
	if (!text) return [];
	const patterns = [
		// "February 26, 2026" / "March 1, 2026"
		/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}/gi,
		// "Feb 26, 2026"
		/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}/gi,
		// "2026-03-05" ISO dates
		/\d{4}-\d{2}-\d{2}/g,
		// "26/02/2026" or "02/26/2026"
		/\d{1,2}\/\d{1,2}\/\d{4}/g,
	];
	const found = new Set();
	for (const pattern of patterns) {
		const matches = text.match(pattern);
		if (matches) {
			for (const m of matches) {
				found.add(m.trim());
			}
		}
	}
	return [...found];
}

/**
 * Regex-based fallback: extract action-like sentences from transcript text.
 * Splits into sentences, then picks those with imperative / request language.
 */
function extractActionItemsFromText(text) {
	if (!text) return [];

	const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);

	// Match sentences with request/imperative language OR scheduling language
	const actionPattern =
		/\b(please\s|kindly\s|I\s+request|ensure\s+that|make\s+sure|finalize\s|upload\s|submit\s|prepare\s|targeting\s|scheduled\s|complete[d]?\s|targeting\s|is\s+to\s+be|will\s+be|needs?\s+to)/i;

	// Date extraction pattern — matches dates after common prepositions
	const datePattern =
		/(?:before|by|until|due|on|targeting|from|to|scheduled\s+(?:for|to\s+be\s+completed\s+by))\s+(?:.*?\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4})/i;

	const items = [];
	const seen = new Set();
	for (const sentence of sentences) {
		if (actionPattern.test(sentence) && !seen.has(sentence)) {
			seen.add(sentence);

			// Try to extract a deadline from the same sentence
			const dateMatch = sentence.match(datePattern);

			items.push({
				task: sentence.trim(),
				responsible: '',
				deadline: dateMatch ? dateMatch[1].trim() : '',
			});
		}
	}
	return items;
}

/**
 * Month name/abbreviation lookup.
 */
const MONTH_NAMES = {
	january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
	july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
	jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date string into { day, month (0-based), year } or null.
 * Supported formats:
 *   - DD-MM-YYYY  (or DD/MM/YYYY)
 *   - YYYY-MM-DD  (ISO)
 *   - Month name formats (e.g., "September 3, 2026", "Sep 3, 2026")
 */
function parseDateParts(dateString) {
	if (typeof dateString !== 'string' || !dateString.trim()) return null;

	const s = dateString.trim();
	let day, month, year;

	// 1) Try "Month DD, YYYY" / "Mon DD, YYYY" (with optional ordinal suffix)
	const namedMatch = s.match(
		/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/
	);
	if (namedMatch) {
		const monthKey = namedMatch[1].toLowerCase();
		if (!(monthKey in MONTH_NAMES)) return null;
		month = MONTH_NAMES[monthKey];
		day = parseInt(namedMatch[2], 10);
		year = parseInt(namedMatch[3], 10);
	} else {
		// 2) Try YYYY-MM-DD
		const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
		if (isoMatch) {
			year = parseInt(isoMatch[1], 10);
			month = parseInt(isoMatch[2], 10) - 1;
			day = parseInt(isoMatch[3], 10);
		} else {
			// 3) Try DD-MM-YYYY  (or DD/MM/YYYY)
			const dMyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
			if (dMyMatch) {
				day = parseInt(dMyMatch[1], 10);
				month = parseInt(dMyMatch[2], 10) - 1;
				year = parseInt(dMyMatch[3], 10);
			} else {
				return null; // unrecognized format
			}
		}
	}

	return { day, month, year };
}

/**
 * Validate a date string.
 * Returns true only when the string represents a real calendar date
 * (correct leap-year handling, no JS auto-correction).
 */
function isValidDate(dateString) {
	const parts = parseDateParts(dateString);
	if (!parts) return false;

	const { day, month, year } = parts;
	const d = new Date(year, month, day);
	return (
		d.getFullYear() === year &&
		d.getMonth() === month &&
		d.getDate() === day
	);
}

/**
 * Full month names for formatting corrected dates.
 */
const MONTH_FULL_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Correct an invalid date by rolling it forward to the next valid date.
 * E.g. "February 29, 2006" (not a leap year) -> "March 1, 2006"
 * Returns the corrected date string in "Month D, YYYY" format,
 * or the original string if already valid, or '' if unparseable.
 */
function correctInvalidDate(dateString) {
	if (!dateString || typeof dateString !== 'string') return '';
	if (isValidDate(dateString)) return dateString;

	const parts = parseDateParts(dateString);
	if (!parts) return '';

	// Let JS auto-correct the date (e.g. Feb 29 non-leap -> Mar 1)
	const corrected = new Date(parts.year, parts.month, parts.day);
	if (isNaN(corrected.getTime())) return '';

	const correctedStr = `${MONTH_FULL_NAMES[corrected.getMonth()]} ${corrected.getDate()}, ${corrected.getFullYear()}`;
	console.info(`[NLP] Corrected invalid date: "${dateString.trim()}" → "${correctedStr}"`);
	return correctedStr;
}

/**
 * Regex to find date strings like "February 29, 2006" inside free text.
 */
const INLINE_DATE_REGEX = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}/gi;

/**
 * Replace every invalid inline date in a text string with its corrected version.
 * E.g. "before February 29, 2006" -> "before March 1, 2006"
 */
function correctInlineDates(text) {
	if (typeof text !== 'string') return text;
	return text.replace(INLINE_DATE_REGEX, (match) => {
		if (isValidDate(match)) return match;
		const corrected = correctInvalidDate(match);
		return corrected || match;
	});
}

/**
 * Post-process NLP output: correct invalid deadlines in action_items,
 * fix invalid dates in task text and summary, and remove action items
 * that have a deadline but no task.
 */
function validateDates(result) {
	// --- Fix invalid dates in summary ---
	if (typeof result.summary === 'string') {
		result.summary = correctInlineDates(result.summary);
	}

	// --- Fix invalid dates in cleaned_transcript ---
	if (typeof result.cleaned_transcript === 'string') {
		result.cleaned_transcript = correctInlineDates(result.cleaned_transcript);
	}

	// --- action_items: correct deadlines and inline dates in task text ---
	if (Array.isArray(result.action_items)) {
		for (const item of result.action_items) {
			// Correct the deadline field
			if (item.deadline) {
				const corrected = correctInvalidDate(item.deadline);
				if (!corrected) {
					console.warn(`⚠ Unparseable deadline removed: ${item.deadline}`);
					item.deadline = '';
				} else {
					item.deadline = corrected;
				}
			}
			// Correct any invalid dates in the task text
			if (item.task) {
				item.task = correctInlineDates(item.task);
			}
		}
		// Remove entries that have a deadline but no actual task
		result.action_items = result.action_items.filter((item) => {
			if (item.deadline && (!item.task || !item.task.trim())) {
				console.warn(`⚠ Deadline without task removed: ${item.deadline}`);
				return false;
			}
			return true;
		});
	}

	return result;
}

function normalizeResult(parsed, originalTranscript) {
	const currentYear = new Date().getFullYear(); // e.g. 2026
	const currentYearStr = currentYear.toString();

	/**
	 * The STT model often mishears "2026" as "2006" (off by 20 years).
	 * Build a map of commonly misheard years to the current year.
	 * Also handle placeholder years like "????", "XXXX", "20XX".
	 */
	const MISHEARD_YEAR = currentYear - 20; // 2006 when currentYear is 2026

	function fixYear(str) {
		if (typeof str !== 'string') return str;
		return str
			.replace(/\?{2,4}/g, currentYearStr)
			.replace(/\bXXXX\b/gi, currentYearStr)
			.replace(/\b20XX\b/gi, currentYearStr)
			.replace(new RegExp(`\\b${MISHEARD_YEAR}\\b`, 'g'), currentYearStr);
	}

	const cleaned = typeof parsed.cleaned_transcript === 'string' && parsed.cleaned_transcript.length > 0
		? fixYear(parsed.cleaned_transcript)
		: originalTranscript || '';

	let summary = typeof parsed.summary === 'string' ? fixYear(parsed.summary) : '';

	// ── Fix summary: strip truncation markers and ensure completeness ──
	// Remove trailing "…" or "..." that indicate the LLM truncated the summary
	summary = summary.replace(/\s*[…]+\s*$/, '').replace(/\s*\.{3,}\s*$/, '').trim();

	// If summary is too short (truncated by LLM) or empty, rebuild from cleaned transcript
	const summaryMinSentences = 3;
	const summarySentences = summary.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);
	if (summarySentences.length < summaryMinSentences && originalTranscript) {
		console.info('[NLP] Summary too short or truncated – rebuilding from transcript');
		const transcriptSentences = originalTranscript
			.split(/(?<=[.!?])\s+/)
			.filter((s) => s.length > 10);
		summary = transcriptSentences.join(' ');
	}

	let actionItems = Array.isArray(parsed.action_items)
		? parsed.action_items.map((item) => ({
				task: fixYear(typeof item?.task === 'string' ? item.task : ''),
				responsible: typeof item?.responsible === 'string' ? item.responsible : '',
				deadline: fixYear(typeof item?.deadline === 'string' ? item.deadline : ''),
			}))
		: [];

	// ── Post-process: extract deadlines from task text if LLM left them blank ──
	const deadlineDatePattern =
  /\b(?:by|before|until|due|on|targeting|scheduled\s+for)\s+((?:next\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}|tomorrow|end\s+of\s+(?:day|week|month|sprint)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
	for (const item of actionItems) {
		if (item.task && !item.deadline) {
			const match = item.task.match(deadlineDatePattern);
			if (match) {
				item.deadline = match[1].trim();
				console.info(`[NLP] Extracted missing deadline "${item.deadline}" from task text`);
			}
		}
	}
	// Secondary pass — extract short deadline phrases from task text
const shortDeadlinePattern = /\b(by\s+(?:next\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|by\s+(?:end\s+of\s+)?(?:this\s+)?(?:week|month)|tomorrow|by\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i;

for (const item of actionItems) {
  if (item.task && (!item.deadline || item.deadline === 'No deadline mentioned' || item.deadline === '')) {
    const match = item.task.match(shortDeadlinePattern);
    if (match) {
      item.deadline = match[1].trim();
      // Clean the deadline phrase from the task text
      item.task = item.task.replace(match[0], '').replace(/,\s*$/, '').trim();
      console.info(`[NLP] Extracted short deadline "${item.deadline}" from task text`);
    }
  }
}

// Final pass — shorten tasks that are still too long and resolve relative dates with chrono
for (const item of actionItems) {
  if (item.task) {
    const words = item.task.split(' ');
    if (words.length > 12) {
      item.task = words.slice(0, 10).join(' ');
    }
  }
  if (!item.deadline || item.deadline.trim() === '' || item.deadline === 'No deadline mentioned') {
    item.deadline = 'No deadline mentioned';
  } else {
    // Handle "this [weekday]" when it matches today's weekday
    const today = new Date();
    const todayWeekday = today.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayWeekdayName = weekdayNames[todayWeekday];
    
    const thisWeekdayPattern = new RegExp(`\\bthis\\s+(${weekdayNames.join('|')})\\b`, 'i');
    const match = item.deadline.match(thisWeekdayPattern);
    
    let resolvedDate;
    if (match && match[1].toLowerCase() === todayWeekdayName) {
      // "this Thursday" and today is Thursday → use today's date
      resolvedDate = new Date(today);
      console.info(`[NLP] "this ${match[1]}" matches today (${todayWeekdayName}) → using today's date`);
    } else {
      // Use chrono-node for other relative/natural-language deadlines
      resolvedDate = chrono.parseDate(item.deadline, new Date());
    }
    
    if (resolvedDate && !isNaN(resolvedDate.getTime())) {
      const month = MONTH_FULL_NAMES[resolvedDate.getMonth()];
      const day = resolvedDate.getDate();
      const year = resolvedDate.getFullYear();
      const resolvedStr = `${month} ${day}, ${year}`;
      console.info(`[NLP] Resolved relative deadline "${item.deadline}" → "${resolvedStr}"`);
      item.deadline = resolvedStr;
    }
  }
}

	// ── Fallback: extract action items if LLM missed them ──
	if (actionItems.length === 0 || actionItems.every((a) => !a.task)) {
		const regexActions = extractActionItemsFromText(originalTranscript);
		if (regexActions.length > 0) {
			console.info('[NLP] LLM returned no action items – using regex fallback');
			actionItems = regexActions;
		}
	}

	// ── Fallback: generate summary if LLM left it completely empty ──
	if (!summary.trim() && originalTranscript) {
		console.info('[NLP] LLM returned empty summary – using full transcript');
		const sentences = originalTranscript
			.split(/(?<=[.!?])\s+/)
			.filter((s) => s.length > 10);
		summary = sentences.join(' ');
	}

	const result = {
		cleaned_transcript: cleaned,
		summary,
		action_items: actionItems,
	};

	// Validate and clean dates before returning
	return validateDates(result);
}

/* ================================================================== */
/*  Map-Reduce helpers                                                 */
/* ================================================================== */

/**
 * Split text into overlapping chunks of approximately `chunkSize` words
 * with `overlap` words shared between consecutive chunks.
 */
function splitIntoChunks(text, chunkSize = CHUNK_SIZE_WORDS, overlap = CHUNK_OVERLAP_WORDS) {
	const words = text.split(/\s+/);
	const chunks = [];
	let start = 0;
	while (start < words.length) {
		const end = Math.min(start + chunkSize, words.length);
		chunks.push(words.slice(start, end).join(' '));
		if (end >= words.length) break;
		start += chunkSize - overlap;
	}
	return chunks;
}

/**
 * Send a single prompt to Ollama with a per-chunk timeout.
 * Uses Node http module instead of native fetch to avoid undici issues
 * with long-running requests.
 */
async function ollamaGenerate(prompt, timeoutMs = PER_CHUNK_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const url = new URL(OLLAMA_URL);
		const jsonBody = JSON.stringify({
			model: OLLAMA_MODEL,
			prompt,
			stream: false,
			format: 'json',
		});

		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			req.destroy(new Error(`Ollama request timed out after ${timeoutMs}ms`));
			reject(new Error(`Ollama request timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		const req = http.request(
			{
				hostname: url.hostname,
				port: url.port || 80,
				path: url.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(jsonBody),
				},
			},
			(res) => {
				let raw = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => { raw += chunk; });
				res.on('end', () => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);

					if (res.statusCode < 200 || res.statusCode >= 300) {
						return reject(new Error(`Ollama request failed (${res.statusCode}): ${raw || res.statusMessage}`));
					}

					try {
						const data = JSON.parse(raw);
						if (!data || typeof data.response !== 'string') {
							return reject(new Error('Unexpected Ollama response shape: missing "response" text.'));
						}
						resolve(data.response);
					} catch (parseErr) {
						reject(new Error(`Failed to parse Ollama response: ${parseErr.message}`));
					}
				});
			},
		);

		req.on('error', (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(err);
		});

		req.write(jsonBody);
		req.end();
	});
}

async function groqGenerate(prompt) {
  const client = getGroqClient();
  if (!client) throw new Error('Groq API key not configured');
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: GROQ_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('Groq returned empty response');
  return text;
}

// Ollama on CPU can be 5-10x slower than cloud APIs — use a generous timeout
const OLLAMA_PRIVATE_TIMEOUT_MS = Number(process.env.OLLAMA_PRIVATE_TIMEOUT_MS || 900_000); // 15 min

async function generateWithFallback(prompt, timeoutMs, processingMode) {
  // In local/private mode, skip Groq entirely and use longer timeout
  if (processingMode === 'local') {
    const ollamaTimeout = Math.max(timeoutMs, OLLAMA_PRIVATE_TIMEOUT_MS);
    console.info('[NLP] Private mode — skipping Groq, using Ollama directly (timeout=%ds)', ollamaTimeout / 1000);
    console.info('[NLP] Using Ollama');
    try {
      return await ollamaGenerate(prompt, ollamaTimeout);
    } catch (err) {
      if (/ECONNREFUSED|fetch failed/i.test(err?.message || '')) {
        throw new Error('Private mode requires Ollama running locally. Start with: ollama serve');
      }
      throw err;
    }
  }

  if (getGroqClient()) {
    try {
      console.info('[NLP] Using Groq (%s)', GROQ_MODEL);
      return await groqGenerate(prompt);
    } catch (err) {
      console.warn(`[NLP] Groq failed: ${err.message} — falling back to Ollama`);
    }
  }
  console.info('[NLP] Using Ollama');
  return await ollamaGenerate(prompt, timeoutMs);
}

/**
 * MAP step: summarize a single chunk.
 */
async function summarizeChunk(chunkText, index, total, processingMode) {
	const prompt = `You are a meeting-transcript summarizer. This is chunk ${index + 1} of ${total}.
Summarize the following transcript chunk. Return ONLY valid JSON with these fields:
{"chunk_summary": "<concise summary of this chunk>", "action_items": [{"task":"","responsible":"","deadline":""}]}

Transcript chunk:
"""${chunkText}"""`;

	console.info(`[NLP/MapReduce] MAP chunk ${index + 1}/${total} | words=${chunkText.split(/\s+/).length}`);
	const raw = await generateWithFallback(prompt, PER_CHUNK_TIMEOUT_MS, processingMode);
	try {
		return parseModelJson(raw);
	} catch {
		// If JSON parsing fails, return raw text as summary
		return { chunk_summary: raw.trim(), action_items: [] };
	}
}

/**
 * REDUCE step: combine chunk summaries into one final output.
 */
async function reduceSummaries(chunkResults, originalTranscript, processingMode) {
	const combinedSummaries = chunkResults
		.map((r, i) => `[Chunk ${i + 1}]: ${r.chunk_summary || ''}`)
		.join('\n\n');

	// Gather all action items from map step
	const allActions = [];
	for (const r of chunkResults) {
		if (Array.isArray(r.action_items)) {
			allActions.push(...r.action_items);
		}
	}

	const reducePrompt = `You are a meeting-transcript processor. You have already summarized a long meeting in chunks.
Below are the chunk summaries and action items gathered so far.

CHUNK SUMMARIES:
${combinedSummaries}

PREVIOUSLY EXTRACTED ACTION ITEMS:
${JSON.stringify(allActions)}

Now combine everything into a single, coherent, comprehensive result. Return ONLY valid JSON:
{"cleaned_transcript": "", "summary": "<unified detailed summary covering ALL topics>", "action_items": [{"task":"","responsible":"","deadline":""}]}

RULES:
- The summary must be thorough and comprehensive — combine and deduplicate the chunk summaries.
- Merge and deduplicate action items. Remove exact duplicates but keep all unique tasks.
- For cleaned_transcript, leave it as an empty string (the original transcript is too long to repeat here).
- Return ONLY valid JSON, no markdown.`;

	console.info(`[NLP/MapReduce] REDUCE | chunks=${chunkResults.length}, collected_actions=${allActions.length}`);
	const raw = await generateWithFallback(reducePrompt, REQUEST_TIMEOUT_MS, processingMode);
	const parsed = parseModelJson(raw);

	// Restore the original cleaned transcript since reduce can't reproduce it
	if (!parsed.cleaned_transcript || parsed.cleaned_transcript.trim() === '') {
		parsed.cleaned_transcript = originalTranscript;
	}

	return parsed;
}

/**
 * Full map-reduce summarization pipeline.
 */
async function mapReduceSummarize(cleanedTranscript, processingMode) {
	const chunks = splitIntoChunks(cleanedTranscript);
	console.info(`[NLP/MapReduce] Splitting transcript into ${chunks.length} chunks (threshold=${MAP_REDUCE_WORD_THRESHOLD} words)`);

	// MAP: summarize each chunk
	const chunkResults = [];
	for (let i = 0; i < chunks.length; i++) {
		try {
			const result = await summarizeChunk(chunks[i], i, chunks.length, processingMode);
			chunkResults.push(result);
		} catch (err) {
			console.warn(`[NLP/MapReduce] Chunk ${i + 1} failed: ${err.message} — using raw text`);
			chunkResults.push({ chunk_summary: chunks[i].substring(0, 500), action_items: [] });
		}
	}

	// REDUCE: combine all chunk summaries
	const reduced = await reduceSummaries(chunkResults, cleanedTranscript, processingMode);
	return reduced;
}

/* ================================================================== */
/*  Main entry point                                                   */
/* ================================================================== */

async function summarizeTranscript(transcriptText, processingMode) {
	if (typeof transcriptText !== 'string' || !transcriptText.trim()) {
		throw new Error('transcriptText must be a non-empty string.');
	}
	// Preprocess transcript
	const cleaned = preprocessTranscript(transcriptText);
	if (cleaned.length < MIN_TRANSCRIPT_LENGTH) {
		throw new Error('Transcript too short or poor quality.');
	}

	const wordCount = cleaned.split(/\s+/).length;
	const useMapReduce = wordCount > MAP_REDUCE_WORD_THRESHOLD;
	const method = useMapReduce ? 'map_reduce' : 'single_pass';

	console.info(`[NLP] Summarization method: ${method} | words=${wordCount} | threshold=${MAP_REDUCE_WORD_THRESHOLD}`);

	if (useMapReduce) {
		// ── Map-Reduce path ──
		let lastError = null;
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				console.info(`[NLP] Map-reduce attempt ${attempt}`);
				const parsed = await mapReduceSummarize(cleaned, processingMode);
				const result = normalizeResult(parsed, cleaned);
				result.summarization_method = 'map_reduce';
				return result;
			} catch (error) {
				lastError = error;
				console.warn(`[NLP] Map-reduce attempt ${attempt} failed: ${error.message}`);
				if (attempt === 2) throw lastError;
			}
		}
	}

	// ── Single-pass path ──
	const rawResponse = await generateWithFallback(buildPrompt(cleaned), REQUEST_TIMEOUT_MS, processingMode);
	const parsed = parseModelJson(rawResponse);
	const result = normalizeResult(parsed, cleaned);
	result.summarization_method = 'single_pass';
	return result;
}

module.exports = { summarizeTranscript, isValidDate };
