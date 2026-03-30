require("dotenv").config();

const express = require("express");
const sttRoutes = require("./routes");

const app = express();
const port = Number(process.env.PORT) || 5002;

app.use(express.json());

// Health check
app.get("/", (_req, res) =>
	res.json({
		success: true,
		service: "stt-service (hybrid)",
		assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
	}),
);

app.use("/api/stt", sttRoutes);

app.listen(port, () => {
	console.log(`STT service (hybrid) running on port ${port}`);
	console.log(
		`  AssemblyAI API key: ${process.env.ASSEMBLYAI_API_KEY ? "configured" : "NOT SET — will use local fallback only"}`,
	);
});
