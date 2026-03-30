const express = require("express");
const { transcribeMeetingController } = require("./stt.controller");

const router = express.Router();

// Hybrid transcription + summarization (AssemblyAI → local fallback)
router.post("/transcribe", transcribeMeetingController);
router.post("/process", transcribeMeetingController);

module.exports = router;
