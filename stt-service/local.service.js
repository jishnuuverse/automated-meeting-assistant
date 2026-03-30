/**
 * Local Fallback Service
 * Handles transcription via local Whisper (local-stt-service)
 * and summarization via local Ollama (nlp-service/summarizer).
 */

const http = require("http");
const { summarizeTranscript } = require("../nlp-service/summarizer");

const LOCAL_STT_URL =
	process.env.LOCAL_STT_URL || "http://127.0.0.1:6000/transcribe";
const LOCAL_STT_TIMEOUT_MS =
	Number(process.env.LOCAL_STT_TIMEOUT_MS) || 600_000; // 10 min

// ─── HTTP helper (avoids Node 20 undici "bad port" bug) ─────────────────────

function httpPost(urlString, bodyObj, timeoutMs) {
	return new Promise((resolve, reject) => {
		const url = new URL(urlString);
		const jsonBody = JSON.stringify(bodyObj);
		const timer = setTimeout(() => {
			req.destroy(new Error(`Local STT request timed out after ${timeoutMs}ms.`));
		}, timeoutMs);

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
					let parsed = null;
					try { parsed = JSON.parse(raw); } catch { /* leave null */ }
					resolve({ statusCode: res.statusCode, body: parsed, raw });
				});
			},
		);

		req.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		req.write(jsonBody);
		req.end();
	});
}

// ─── Transcription (local Whisper) ──────────────────────────────────────────

/**
 * Transcribe audio via the local-stt-service (Whisper).
 *
 * @param {string} audioFilePath  Absolute path to the audio file.
 * @param {string} meetingId      Meeting identifier for the local service.
 * @returns {Promise<string>}     The transcript text.
 */
async function transcribe(audioFilePath, meetingId) {
	console.info("[Local] Starting Whisper transcription:", audioFilePath);

	try {
		const { statusCode, body, raw } = await httpPost(
			LOCAL_STT_URL,
			{ meetingId: meetingId || "meeting", audioFilePath },
			LOCAL_STT_TIMEOUT_MS,
		);

		if (statusCode < 200 || statusCode >= 300) {
			throw new Error(
				`local-stt-service responded ${statusCode}: ${body?.error || body?.detail || raw || "unknown error"}`,
			);
		}

		if (!body?.success) {
			throw new Error(
				body?.error || body?.detail || "local-stt-service returned unsuccessful response.",
			);
		}

		const text = (body.transcript || "").trim();
		console.info("[Local] Whisper transcription complete | length=%d", text.length);

		return text;
	} catch (error) {
		throw error;
	}
}

// ─── Summarization (Ollama) ─────────────────────────────────────────────────

/**
 * Summarize a transcript using the local Ollama model (via nlp-service module).
 *
 * @param {string} transcriptText
 * @param {string} [processingMode]  'cloud' | 'local' — forwarded to summarizer.
 * @returns {Promise<object>}  { cleaned_transcript, summary, action_items }
 */
async function summarize(transcriptText, processingMode) {
	console.info("[Local] Starting Ollama summarization | length=%d | mode=%s", transcriptText.length, processingMode || 'default');

	const result = await summarizeTranscript(transcriptText, processingMode);

	console.info("[Local] Ollama summarization complete");
	return result;
}

module.exports = {
	transcribe,
	summarize,
};
