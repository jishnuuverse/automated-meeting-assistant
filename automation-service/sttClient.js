// Point to the hybrid stt-service (AssemblyAI → local Whisper+Ollama fallback)
const STT_ENDPOINT = process.env.STT_ENDPOINT || "http://127.0.0.1:5002/api/stt/process";
const NLP_ENDPOINT = process.env.NLP_ENDPOINT || "http://localhost:7000/summarize";
const DEFAULT_TIMEOUT_MS = 600000; // 10 min — AssemblyAI upload + transcription + LeMUR can take time
const NLP_TIMEOUT_MS = Number(process.env.NLP_TIMEOUT_MS || 180000);
const DEFAULT_RETRIES = Number(process.env.STT_REQUEST_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.STT_RETRY_DELAY_MS || 2000);
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Session guard: prevent duplicate STT+NLP pipeline runs per meeting ──
let isPipelineActive = false;
let activePipelineMeetingId = null;
const NLP_TRANSCRIPTS_DIR = process.env.NLP_TRANSCRIPTS_DIR || path.join(__dirname, "..", "nlp-service", "transcripts");

function assertValidInput(meetingId, audioFilePath) {
	if (!meetingId || typeof meetingId !== "string") {
		throw new TypeError("meetingId must be a non-empty string.");
	}

	if (!audioFilePath || typeof audioFilePath !== "string") {
		throw new TypeError("audioFilePath must be a non-empty string.");
	}
}

async function triggerTranscription(meetingId, audioFilePath, processingMode) {
	assertValidInput(meetingId, audioFilePath);
	const effectiveMode = processingMode || 'cloud';

	// ── Pipeline guard: reject if already processing a meeting ──
	if (isPipelineActive) {
		console.warn(`[STT] Pipeline already active for meeting "${activePipelineMeetingId}" — skipping duplicate request for "${meetingId}"`);
		throw new Error(`STT+NLP pipeline is already active for meeting "${activePipelineMeetingId}". Duplicate request rejected.`);
	}
	isPipelineActive = true;
	activePipelineMeetingId = meetingId;

	console.info("[STT] Transcription request started", {
		meetingId,
		audioFilePath,
		endpoint: STT_ENDPOINT,
		retries: DEFAULT_RETRIES,
		processing_mode: effectiveMode,
	});

	let lastError;
	for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

		try {
			const payload = await sendTranscriptionRequest({
				meetingId,
				audioFilePath,
				controller,
				processingMode: effectiveMode,
			});

			const transcriptText = typeof payload?.transcript === "string" ? payload.transcript : "";

			// The hybrid stt-service returns summary directly (from AssemblyAI or Ollama).
			// Only call NLP separately if the hybrid service didn't return a summary.
			let analysis = payload?.summary || null;
			if (!analysis && transcriptText.trim()) {
				console.info("[STT] Hybrid service returned no summary — calling NLP separately");
				analysis = await runNlpAnalysisSafely(meetingId, transcriptText, effectiveMode);
			} else if (analysis) {
				console.info("[STT] Using summary from hybrid service (source: %s)", payload?.source || "unknown");
				await saveAnalysisToFile(meetingId, analysis);
			}

			if (analysis) {
				payload.analysis = analysis;
			}

			console.info("[STT] Transcription request completed", {
				meetingId,
				transcriptLength: transcriptText.length,
			});

			// ── Pipeline guard: release on success ──
			isPipelineActive = false;
			activePipelineMeetingId = null;

			return payload;
		} catch (error) {
			lastError = error;
			const isAbort = error?.name === "AbortError";
			const retryable = isAbort || /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(error?.message || ""));

			console.warn(`[STT] Attempt ${attempt}/${DEFAULT_RETRIES} failed: ${error.message}`);
			if (!retryable || attempt === DEFAULT_RETRIES) {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		} finally {
			clearTimeout(timeout);
		}
	}

	// ── Pipeline guard: release on failure ──
	isPipelineActive = false;
	activePipelineMeetingId = null;

	if (lastError?.name === "AbortError") {
		throw new Error(`STT request timed out after ${DEFAULT_TIMEOUT_MS}ms.`);
	}

	throw new Error(`Failed to trigger transcription: ${lastError?.message || "Unknown error"}`);
}

function normalizeMeetingId(meetingId) {
	return String(meetingId).trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function runNlpAnalysisSafely(meetingId, transcriptText, processingMode) {
	if (!transcriptText.trim()) {
		console.warn("[NLP] Skipping summarization: transcript is empty.");
		return null;
	}

	try {
		const analysis = await requestNlpSummary(transcriptText, processingMode);
		console.info("[NLP] Structured summary:", JSON.stringify(analysis, null, 2));
		await saveAnalysisToFile(meetingId, analysis);
		return analysis;
	} catch (error) {
		console.warn(`[NLP] Summarization failed (continuing): ${error?.message || error}`);
		return null;
	}
}

async function requestNlpSummary(transcriptText, processingMode) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), NLP_TIMEOUT_MS);

	try {
		const response = await fetch(NLP_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ transcript: transcriptText, processing_mode: processingMode || 'cloud' }),
			signal: controller.signal,
		});

		const payload = await parseJsonResponse(response);
		if (!response.ok) {
			const detail = payload?.error || payload?.detail || response.statusText;
			throw new Error(`NLP request failed with status ${response.status}: ${detail}`);
		}

		if (!payload || payload.success !== true || !payload.result) {
			const detail = payload?.error || payload?.detail || "Invalid NLP response.";
			throw new Error(`NLP service returned unsuccessful response: ${detail}`);
		}

		return payload.result;
	} catch (error) {
		if (error?.name === "AbortError") {
			throw new Error(`NLP request timed out after ${NLP_TIMEOUT_MS}ms.`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

async function saveAnalysisToFile(meetingId, analysis) {
	const safeMeetingId = normalizeMeetingId(meetingId);
	const analysisDir = NLP_TRANSCRIPTS_DIR;
	const outputPath = path.join(analysisDir, `meeting_${safeMeetingId}.json`);

	await fs.promises.mkdir(analysisDir, { recursive: true });
	await fs.promises.writeFile(outputPath, JSON.stringify(analysis, null, 2), "utf8");

	console.info(`[NLP] Analysis saved to ${outputPath}`);
}

async function sendTranscriptionRequest({ meetingId, audioFilePath, controller, processingMode }) {
	const body = JSON.stringify({ meetingId, audioFilePath, processing_mode: processingMode || 'cloud' });

	try {
		const response = await fetch(STT_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			signal: controller.signal,
		});

		const payload = await parseJsonResponse(response);
		if (!response.ok) {
			const detail = payload?.detail || payload?.error || response.statusText;
			throw new Error(`STT request failed with status ${response.status}: ${detail}`);
		}

		if (!payload || payload.success !== true) {
			const detail = payload?.error || payload?.detail || "Unknown STT server error.";
			throw new Error(`STT server returned unsuccessful response: ${detail}`);
		}

		return payload;
	} catch (error) {
		const message = String(error?.message || "").toLowerCase();
		const causeMessage = String(error?.cause?.message || "").toLowerCase();
		const shouldFallback = message.includes("fetch failed") || causeMessage.includes("bad port");

		if (!shouldFallback) {
			throw error;
		}

		console.warn("[STT] Native fetch failed, using direct HTTP fallback:", error.message);
		return sendViaDirectHttp(STT_ENDPOINT, body, controller.signal);
	}
}

async function parseJsonResponse(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function sendViaDirectHttp(endpoint, body, abortSignal) {
	return new Promise((resolve, reject) => {
		const url = new URL(endpoint);
		const client = url.protocol === "https:" ? https : http;

		const request = client.request(
			{
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || (url.protocol === "https:" ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(response) => {
				let rawData = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					rawData += chunk;
				});
				response.on("end", () => {
					let payload = null;
					try {
						payload = rawData ? JSON.parse(rawData) : null;
					} catch {
						payload = null;
					}

					if (response.statusCode < 200 || response.statusCode >= 300) {
						const detail = payload?.detail || payload?.error || `HTTP ${response.statusCode}`;
						reject(new Error(`STT request failed with status ${response.statusCode}: ${detail}`));
						return;
					}

					if (!payload || payload.success !== true) {
						const detail = payload?.error || payload?.detail || "Unknown STT server error.";
						reject(new Error(`STT server returned unsuccessful response: ${detail}`));
						return;
					}

					resolve(payload);
				});
			}
		);

		request.on("error", (err) => {
			reject(err);
		});

		if (abortSignal) {
			abortSignal.addEventListener("abort", () => {
				request.destroy(new Error("Request aborted"));
			});
		}

		request.write(body);
		request.end();
	});
}

module.exports = {
	triggerTranscription,
};
