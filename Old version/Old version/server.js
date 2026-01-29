import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import formidable from "formidable";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEPARTMENTS = ["Finance", "Compliance", "Operations", "HR", "Board", "IT"];

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Health check endpoint for Railway
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Helper functions
function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function guessType(file) {
  const name = (file?.originalFilename || "").toLowerCase();
  const type = (file?.mimetype || "").toLowerCase();

  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (type === "application/pdf") return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";

  return null;
}

async function parseMultipart(req) {
  return await new Promise((resolve, reject) => {
    const form = formidable({
      multiples: true,
      maxFileSize: 10 * 1024 * 1024
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

async function extractText(file) {
  const kind = guessType(file);
  if (!kind) {
    const e = new Error("Unsupported file type. Please upload a PDF or DOCX.");
    e.statusCode = 400;
    throw e;
  }

  const buf = await fs.readFile(file.filepath);

  if (kind === "pdf") {
    const parsed = await pdfParse(buf);
    return (parsed.text || "").trim();
  }

  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value || "").trim();
}

function buildJsonSchemaDescription(outputs) {
  const schemaObj = {
    type: "object",
    properties: {},
    required: []
  };

  if (outputs.includes("translation")) {
    schemaObj.properties.translated_text = { type: "string", description: "Full translation of the document" };
    schemaObj.required.push("translated_text");
  }

  if (outputs.includes("summary")) {
    schemaObj.properties.summary = { type: "string", description: "Detailed summary of the document" };
    schemaObj.required.push("summary");
  }

  if (outputs.includes("key_points")) {
    schemaObj.properties.key_points = {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          department: { type: "string", enum: DEPARTMENTS },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["point", "department", "tags"]
      }
    };
    schemaObj.required.push("key_points");
  }

  if (outputs.includes("todos")) {
    const todoItem = {
      type: "object",
      properties: {
        task: { type: "string" },
        source_point: { type: "string" }
      },
      required: ["task", "source_point"]
    };

    schemaObj.properties.todos_by_department = {
      type: "object",
      properties: {
        Finance: { type: "array", items: todoItem },
        Compliance: { type: "array", items: todoItem },
        Operations: { type: "array", items: todoItem },
        HR: { type: "array", items: todoItem },
        Board: { type: "array", items: todoItem },
        IT: { type: "array", items: todoItem }
      },
      required: DEPARTMENTS
    };
    schemaObj.required.push("todos_by_department");
  }

  if (outputs.includes("cross_reference")) {
    schemaObj.properties.cross_reference = {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          found_in: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] }
        },
        required: ["question", "answer", "found_in", "confidence"]
      }
    };
    schemaObj.required.push("cross_reference");
  }

  if (outputs.includes("generate_template")) {
    schemaObj.properties.response_template = { type: "string", description: "Response template for the document" };
    schemaObj.required.push("response_template");
  }

  return JSON.stringify(schemaObj, null, 2);
}

// Main API endpoint
app.post("/api/analyze", async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
    }

    const { fields, files } = await parseMultipart(req);

    const uploaded = files?.file;
    const mainFile = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    if (!mainFile) return res.status(400).json({ error: "Missing multipart field: file" });

    const targetLanguage = String(first(fields?.targetLanguage || "")).trim();
    if (!targetLanguage) return res.status(400).json({ error: "Missing multipart field: targetLanguage" });

    const outputs = toArray(fields?.outputs).map(String);
    if (!outputs.length) return res.status(400).json({ error: "Select at least one output." });

    const wantsCross = outputs.includes("cross_reference");
    const wantsTemplate = outputs.includes("generate_template");

    const docText = await extractText(mainFile);
    if (!docText) return res.status(400).json({ error: "Could not extract any text from the uploaded file." });

    let crossText = "";
    if (wantsCross || wantsTemplate) {
      const crossFiles = toArray(files?.crossFiles);
      if (crossFiles.length) {
        const parts = [];
        for (let i = 0; i < crossFiles.length; i++) {
          const t = await extractText(crossFiles[i]);
          if (t) {
            parts.push(`--- Cross document ${i + 1}: ${crossFiles[i]?.originalFilename || "file"} ---\n${t}`);
          }
        }
        crossText = parts.join("\n\n");
      }
    }

    const schemaDescription = buildJsonSchemaDescription(outputs);

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = [
      `Target language: ${targetLanguage}`,
      `Requested outputs: ${outputs.join(", ")}`,
      "",
      "You must respond with ONLY valid JSON matching the following schema:",
      "```json",
      schemaDescription,
      "```",
      "",
      "Rules:",
      "- Use ONLY the MAIN DOCUMENT for translation/summary/key points/to-dos.",
      "- Use CROSS DOCUMENTS for cross-reference and to help fill the response template when available.",
      "",
      "Summary requirement (if requested):",
      "- More detailed than a short abstract.",
      "- Include key context, key decisions, important constraints, and risks/implications if present.",
      "- Aim for ~8-12 sentences unless the document is extremely short.",
      "",
      "Template requirement (if requested):",
      "- response_template should be a structured, reusable email/letter-style reply to the inquiry in the MAIN DOCUMENT.",
      "- Include sections like greeting, reference to the inquiry, key answers, and closing.",
      "- If relevant information is clearly present in CROSS DOCUMENTS (for example KYC data lists), incorporate it directly into the template.",
      "- If relevant information is not present, leave clearly marked placeholders (e.g. [INSERT KYC DATA HERE]) for the user to fill manually.",
      "",
      `Allowed departments: ${DEPARTMENTS.join(", ")}`,
      "",
      "Cross-reference requirement (if requested):",
      "- Identify questions/unknowns/requests in the MAIN DOCUMENT.",
      "- Search CROSS DOCUMENTS for answers/evidence.",
      "- If not found: answer=\"\", confidence=\"low\", found_in=\"not found\".",
      "",
      "MAIN DOCUMENT:",
      docText,
      "",
      (wantsCross || wantsTemplate) ? "CROSS DOCUMENTS:" : "",
      (wantsCross || wantsTemplate) ? (crossText || "(none provided)") : ""
    ].filter(Boolean).join("\n");

    const modelName = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

    const message = await anthropic.messages.create({
      model: modelName,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    // Extract text from response
    const responseText = message.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("");

    // Parse JSON from response - handle potential markdown code blocks
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.slice(7);
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith("```")) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    let out;
    try {
      out = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({
        error: "Claude returned non-JSON output unexpectedly.",
        details: responseText || null
      });
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error("Error processing request:", err);
    const status = err?.statusCode || 500;
    return res.status(status).json({ error: err?.message || "Server error" });
  }
});

// Serve index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at /health`);
});
