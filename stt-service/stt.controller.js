const { processMeeting } = require("./orchestrator");

/**
 * POST /api/stt/transcribe
 *
 * Hybrid transcription + summarization controller.
 *   - Tries AssemblyAI first (transcription + LeMUR summary).
 *   - Falls back to local Whisper + Ollama on any AssemblyAI failure.
 *   - Returns a unified JSON structure regardless of source.
 */
async function transcribeMeetingController(req, res) {
	try {
		const { meetingId, audioFilePath, processing_mode } = req.body || {};

		if (!meetingId) {
			return res.status(400).json({
				success: false,
				error: "meetingId is required.",
			});
		}

		if (!audioFilePath || typeof audioFilePath !== "string") {
			return res.status(400).json({
				success: false,
				error: "audioFilePath is required and must be a string.",
			});
		}

		const result = await processMeeting(audioFilePath, meetingId, processing_mode);

		// Map to HTTP status: 200 on success, 502 if both pipelines failed.
		const statusCode = result.success ? 200 : 502;

		return res.status(statusCode).json(result);
	} catch (error) {
		// Unexpected / unhandled error — never crash the service.
		console.error("[Controller] Unhandled error:", error);
		return res.status(500).json({
			success: false,
			source: "none",
			transcript: "",
			summary: null,
			error: error?.message || "Internal server error.",
		});
	}
}

module.exports = {
	transcribeMeetingController,
};
