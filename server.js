import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const app = express();
const PORT = process.env.PORT || 3000;
const DEPARTMENTS = ["Finance", "Compliance", "Operations", "HR", "Board", "IT"];

// Multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowed.includes(file.mimetype) || /\.(pdf|docx)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files are allowed"));
    }
  }
});

// CORS
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

// Serve static frontend
app.use(express.static("public"));

// Claude client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Extract text from uploaded file
async function extractText(file) {
  const buf = file.buffer;
  const name = (file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();

  const isPdf = name.endsWith(".pdf") || mime === "application/pdf";
  const isDocx = name.endsWith(".docx") || mime.includes("wordprocessingml");

  if (isPdf) {
    const parsed = await pdfParse(buf);
    return (parsed.text || "").trim();
  }
  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result.value || "").trim();
  }
  throw Object.assign(new Error("Unsupported file type"), { statusCode: 400 });
}

// Build the prompt for Claude
function buildPrompt(outputs, targetLang, docText, crossText) {
  const wantsCross = outputs.includes("cross_reference");
  const wantsTemplate = outputs.includes("generate_template");

  return `You are a document analysis assistant. Analyze the provided document and return ONLY valid JSON.

Target language: ${targetLang}
Requested outputs: ${outputs.join(", ")}
Allowed departments: ${DEPARTMENTS.join(", ")}

Instructions:
- Use ONLY the MAIN DOCUMENT for translation, summary, key_points, and todos.
- Use CROSS DOCUMENTS (if provided) for cross_reference and to help fill response_template.

Output requirements:
${outputs.includes("translation") ? '- "translated_text": Full translation of the main document.' : ""}
${outputs.includes("summary") ? '- "summary": Detailed summary (8-12 sentences) including key context, decisions, constraints, and risks.' : ""}
${outputs.includes("key_points") ? `- "key_points": Array of { "point": string, "department": one of [${DEPARTMENTS.join(", ")}], "tags": string[] }` : ""}
${outputs.includes("todos") ? `- "todos_by_department": Object with keys ${DEPARTMENTS.join(", ")}, each containing array of { "task": string, "source_point": string }` : ""}
${wantsCross ? '- "cross_reference": Array of { "question": string, "answer": string, "found_in": string, "confidence": "low"|"medium"|"high" }. Search cross documents for answers to questions/requests in main document.' : ""}
${wantsTemplate ? '- "response_template": A structured email/letter reply template. Include greeting, reference to inquiry, key answers (use cross-document data if available), and closing. Use [PLACEHOLDER] for missing info.' : ""}

Return ONLY the JSON object with the requested fields. No markdown, no explanations.

=== MAIN DOCUMENT ===
${docText}

${(wantsCross || wantsTemplate) ? `=== CROSS DOCUMENTS ===
${crossText || "(none provided)"}` : ""}`;
}

// Main analyze endpoint
app.post("/api/analyze", upload.fields([
  { name: "file", maxCount: 1 },
  { name: "crossFiles", maxCount: 10 }
]), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    }

    const mainFile = req.files?.file?.[0];
    if (!mainFile) {
      return res.status(400).json({ error: "Missing file upload" });
    }

    const targetLang = (req.body.targetLanguage || "").trim();
    if (!targetLang) {
      return res.status(400).json({ error: "Missing targetLanguage" });
    }

    let outputs = req.body.outputs || [];
    if (!Array.isArray(outputs)) outputs = [outputs];
    outputs = outputs.filter(Boolean);
    if (!outputs.length) {
      return res.status(400).json({ error: "Select at least one output" });
    }

    // Extract main document text
    const docText = await extractText(mainFile);
    if (!docText) {
      return res.status(400).json({ error: "Could not extract text from the uploaded file" });
    }

    // Extract cross-reference documents if needed
    let crossText = "";
    const wantsCross = outputs.includes("cross_reference") || outputs.includes("generate_template");
    if (wantsCross && req.files?.crossFiles?.length) {
      const parts = [];
      for (let i = 0; i < req.files.crossFiles.length; i++) {
        const f = req.files.crossFiles[i];
        const t = await extractText(f);
        if (t) parts.push(`--- Cross document ${i + 1}: ${f.originalname || "file"} ---\n${t}`);
      }
      crossText = parts.join("\n\n");
    }

    // Build prompt and call Claude
    const prompt = buildPrompt(outputs, targetLang, docText, crossText);

    const message = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }]
    });

    // Extract text response
    const responseText = message.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    // Parse JSON (handle potential markdown fences)
    let result;
    try {
      const cleaned = responseText.replace(/^```json\s*|```$/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({
        error: "Claude returned non-JSON output",
        details: responseText.slice(0, 500)
      });
    }

    return res.json(result);

  } catch (err) {
    console.error("Error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
