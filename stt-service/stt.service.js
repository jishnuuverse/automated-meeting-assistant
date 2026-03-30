const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

let openaiClient;

function getOpenAIClient() {
	if (openaiClient) {
		return openaiClient;
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("Missing OPENAI_API_KEY environment variable.");
	}

	openaiClient = new OpenAI({ apiKey });
	return openaiClient;
}

async function ensureReadableFile(audioFilePath) {
	if (!audioFilePath || typeof audioFilePath !== "string") {
		throw new TypeError("audioFilePath must be a non-empty string.");
	}

	const resolvedPath = path.resolve(audioFilePath);

	let fileStat;
	try {
		fileStat = await fs.promises.stat(resolvedPath);
	} catch {
		throw new Error(`Audio file does not exist: ${resolvedPath}`);
	}

	if (!fileStat.isFile()) {
		throw new Error(`Audio path is not a file: ${resolvedPath}`);
	}

	await fs.promises.access(resolvedPath, fs.constants.R_OK);
	return resolvedPath;
}

async function transcribeAudioFile(audioFilePath) {
	try {
		const resolvedPath = await ensureReadableFile(audioFilePath);
		const client = getOpenAIClient();

		const response = await client.audio.transcriptions.create({
			file: fs.createReadStream(resolvedPath),
			model: "gpt-4o-transcribe",
		});

		const transcriptText = response?.text;
		if (!transcriptText || typeof transcriptText !== "string") {
			throw new Error("OpenAI transcription response did not include transcript text.");
		}

		return transcriptText;
	} catch (error) {
		const statusCode = error?.status || error?.statusCode;
		const apiMessage = error?.response?.data?.error?.message || error?.message;
		const details = statusCode ? ` (status ${statusCode})` : "";

		throw new Error(`Failed to transcribe audio${details}: ${apiMessage}`);
	}
}

module.exports = {
	transcribeAudioFile,
};
