/**
 * Hybrid Meeting Orchestrator
 *
 * process_meeting(audioFilePath, meetingId)
 *
 * Strategy:
 *   1. Try AssemblyAI transcription.
 *   2. If transcription succeeds, try AssemblyAI LeMUR summarization.
 *   3. If LeMUR fails (e.g. no access), use Ollama to summarize the AssemblyAI transcript.
 *   4. If AssemblyAI transcription itself fails, fall back to local Whisper + Ollama.
 *   5. Return a unified result regardless of source.
 */

const assemblyai = require("./assemblyai.service");
const local = require("./local.service");
const { withRetry } = require("./retry");
const http = require("http");

const NLP_INTEGRATIONS_URL =
	process.env.NLP_INTEGRATIONS_URL || "http://localhost:7000/integrations/ingest";
const NLP_INTEGRATION_TIMEOUT_MS = 10_000; // 10 s — fire-and-forget, don't block

/**
 * Notify the NLP service to push summary → Notion + Calendar.
 * Runs in the background; failures are logged, never thrown.
 */
async function pushIntegrations(summary) {
	if (!summary) return;
	try {
		const url = new URL(NLP_INTEGRATIONS_URL);
		const jsonBody = JSON.stringify(summary);

		const result = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				req.destroy(new Error('Integration push timed out'));
			}, NLP_INTEGRATION_TIMEOUT_MS);

			const req = http.request(
				{
					hostname: url.hostname,
					port: url.port || 80,
					path: url.pathname + url.search,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(jsonBody),
					},
				},
				(res) => {
					let raw = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => { raw += chunk; });
					res.on("end", () => {
						clearTimeout(timer);
						resolve({ statusCode: res.statusCode, raw });
					});
				},
			);
			req.on("error", (err) => { clearTimeout(timer); reject(err); });
			req.write(jsonBody);
			req.end();
		});

		if (result.statusCode < 200 || result.statusCode >= 300) {
			console.warn("[Orchestrator] Integration push returned %d: %s", result.statusCode, result.raw);
		} else {
			console.info("[Orchestrator] Integration push accepted.");
		}
	} catch (err) {
		console.warn("[Orchestrator] Integration push failed (non-blocking): %s", err?.message || err);
	}
}

/**
 * Orchestrate meeting transcription + summarization.
 *
 * @param {string} audioFilePath  Absolute path to the audio file.
 * @param {string} [meetingId]    Optional meeting identifier (used by local fallback).
 * @param {string} [processingMode] 'cloud' | 'local' — controls pipeline routing.
 * @returns {Promise<{*}>}
 */
async function processMeeting(audioFilePath, meetingId, processingMode) {
	const mode = (processingMode === 'local') ? 'local' : 'cloud';
	const isPrivate = mode === 'local';
	console.info("[Orchestrator] Processing mode: %s (privacy_mode=%s)", mode, isPrivate);

	// ── LOCAL MODE: skip cloud services entirely ────────────────────────
	if (isPrivate) {
		console.info("[Orchestrator] Private mode — going directly to local Whisper + Ollama");
		const result = await localFallback(audioFilePath, meetingId, 'User selected Private Mode', mode);
		result.processing_mode = 'local';
		result.privacy_mode = true;
		return result;
	}

	// ── CLOUD MODE: existing AssemblyAI → fallback flow ─────────────────
	let assemblyTranscript = null;
	let transcribeRetryAttempts = 0;

	// ── 1. Try AssemblyAI transcription (with retry) ─────────────────────────
	try {
		console.info("[Orchestrator] Attempting AssemblyAI transcription…");

		const result = await withRetry(
			() => assemblyai.transcribe(audioFilePath),
			3,  // maxRetries
			1000 // baseDelayMs → 1s, 2s, 4s
		);
		transcribeRetryAttempts = result.retry_attempts || 1;
		assemblyTranscript = { transcriptId: result.transcriptId, text: result.text };

		console.info("[Orchestrator] AssemblyAI transcription succeeded (id=%s, length=%d, retries=%d)",
			result.transcriptId, result.text.length, transcribeRetryAttempts);
	} catch (transcribeError) {
		transcribeRetryAttempts = transcribeError?.retry_attempts || 0;
		const reason = transcribeError?.message || String(transcribeError);
		console.warn("[Orchestrator] AssemblyAI transcription failed after %d attempt(s): %s", transcribeRetryAttempts, reason);

		// Transcription failed — fall back to full local pipeline
		const fallbackResult = await localFallback(audioFilePath, meetingId, reason, mode);
		fallbackResult.retry_attempts = { transcribe: transcribeRetryAttempts };
		fallbackResult.processing_mode = fallbackResult.processing_mode || 'cloud';
		fallbackResult.privacy_mode = fallbackResult.privacy_mode || false;
		return fallbackResult;
	}

	// ── 2. Transcription succeeded — try AssemblyAI LeMUR summarization (with retry) ─
	let summarizeRetryAttempts = 0;
	try {
		console.info("[Orchestrator] Attempting AssemblyAI LeMUR summarization…");

		const summary = await withRetry(
			() => assemblyai.summarize(assemblyTranscript.transcriptId),
			3,
			1000
		);
		summarizeRetryAttempts = summary?.retry_attempts || 1;

		console.info("[Orchestrator] Full AssemblyAI pipeline succeeded (retries: transcribe=%d, summarize=%d).",
			transcribeRetryAttempts, summarizeRetryAttempts);

		// Push to Notion + Calendar in the background
		pushIntegrations(summary);

		return {
			success: true,
			source: "assemblyai",
			transcript: assemblyTranscript.text,
			summary,
			retry_attempts: { transcribe: transcribeRetryAttempts, summarize: summarizeRetryAttempts },
			processing_mode: 'cloud',
			privacy_mode: false,
		};
	} catch (summarizeError) {
		summarizeRetryAttempts = summarizeError?.retry_attempts || 0;
		const reason = summarizeError?.message || String(summarizeError);
		console.warn("[Orchestrator] AssemblyAI LeMUR failed after %d attempt(s): %s", summarizeRetryAttempts, reason);
		console.info("[Orchestrator] Using Ollama to summarize AssemblyAI transcript…");

		// ── 3. LeMUR failed — use Ollama summarization with AssemblyAI transcript ─
		try {
			const summary = await local.summarize(assemblyTranscript.text, mode);

			console.info("[Orchestrator] AssemblyAI transcription + Ollama summarization succeeded.");

			// Push to Notion + Calendar in the background
			pushIntegrations(summary);

			return {
				success: true,
				source: "assemblyai+ollama",
				transcript: assemblyTranscript.text,
				summary,
				fallbackReason: `LeMUR unavailable: ${reason}`,
				retry_attempts: { transcribe: transcribeRetryAttempts, summarize: summarizeRetryAttempts },
				processing_mode: 'cloud',
				privacy_mode: false,
			};
		} catch (ollamaError) {
			const ollamaReason = ollamaError?.message || String(ollamaError);
			console.error("[Orchestrator] Ollama summarization also failed: %s", ollamaReason);

			// Return transcript without summary rather than failing entirely
			return {
				success: true,
				source: "assemblyai",
				transcript: assemblyTranscript.text,
				summary: null,
				summaryError: `LeMUR: ${reason} | Ollama: ${ollamaReason}`,
				retry_attempts: { transcribe: transcribeRetryAttempts, summarize: summarizeRetryAttempts },
				processing_mode: 'cloud',
				privacy_mode: false,
			};
		}
	}
}

/**
 * Full local fallback: Whisper transcription + Ollama summarization.
 */
async function localFallback(audioFilePath, meetingId, assemblyReason, processingMode) {
	console.info("[Orchestrator] Falling back to full local pipeline…");

	try {
		const transcript = await local.transcribe(audioFilePath, meetingId);
		const summary = await local.summarize(transcript, processingMode);

		console.info("[Orchestrator] Local pipeline succeeded.");

		// Push to Notion + Calendar in the background
		pushIntegrations(summary);

		return {
			success: true,
			source: "local",
			transcript,
			summary,
			fallbackReason: assemblyReason,
		};
	} catch (localError) {
		const localReason = localError?.message || String(localError);
		console.error("[Orchestrator] Local pipeline also failed: %s", localReason);

		return {
			success: false,
			source: "none",
			transcript: "",
			summary: null,
			error: `Both pipelines failed. AssemblyAI: ${assemblyReason} | Local: ${localReason}`,
		};
	}
}

module.exports = { processMeeting };
