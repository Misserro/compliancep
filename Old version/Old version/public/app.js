// Use relative path - works for any deployment
const ENDPOINT = "/api/analyze";

const form = document.getElementById("analyzeForm");
const fileInput = document.getElementById("fileInput");
const crossFilesInput = document.getElementById("crossFiles");
const translateTo = document.getElementById("translateTo");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const outputsWrap = document.getElementById("outputs");

const statusEl = document.getElementById("status");

const translatedDisclosure = document.getElementById("translatedDisclosure");
const translatedDocEl = document.getElementById("translatedDoc");
const summaryEl = document.getElementById("summary");
const keyPointsEl = document.getElementById("keyPoints");
const todosEl = document.getElementById("todos");
const crossRefEl = document.getElementById("crossRef");
const templateBoxEl = document.getElementById("templateBox");
const templateFillToggle = document.getElementById("templateFillToggle");

const exportTranslationBtn = document.getElementById("exportTranslationBtn");
const exportTodosBtn = document.getElementById("exportTodosBtn");
const exportTemplateBtn = document.getElementById("exportTemplateBtn");

const DEPARTMENTS = ["Finance", "Compliance", "Operations", "HR", "Board", "IT"];

let lastResult = null;
let originalTemplateText = "";

function setStatus(message, kind = "info") {
  statusEl.classList.remove("good", "bad", "warn");
  if (kind === "good") statusEl.classList.add("good");
  if (kind === "bad") statusEl.classList.add("bad");
  if (kind === "warn") statusEl.classList.add("warn");
  statusEl.textContent = message;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "'");
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function getSelectedOutputs() {
  const checks = [...outputsWrap.querySelectorAll('input[type="checkbox"][name="outputs"]')];
  return checks.filter(c => c.checked).map(c => c.value);
}

function updateAnalyzeEnabled(showStatus = true) {
  const outputs = getSelectedOutputs();
  const enabled = outputs.length >= 1;
  analyzeBtn.disabled = !enabled;

  if (!showStatus) return;
  if (!enabled) setStatus("Choose at least one output to enable Analyze.", "warn");
  else setStatus("Ready.", "info");
}

outputsWrap.addEventListener("change", () => updateAnalyzeEnabled(true));
updateAnalyzeEnabled(true);

function resetResults() {
  lastResult = null;
  originalTemplateText = "";

  translatedDocEl.textContent = "No data yet.";
  summaryEl.textContent = "No data yet.";
  keyPointsEl.textContent = "No data yet.";
  todosEl.textContent = "No data yet.";
  crossRefEl.textContent = "No data yet.";
  templateBoxEl.textContent = "No data yet.";

  translatedDocEl.classList.add("subtle");
  summaryEl.classList.add("subtle");
  keyPointsEl.classList.add("subtle");
  todosEl.classList.add("subtle");
  crossRefEl.classList.add("subtle");
  templateBoxEl.classList.add("subtle");

  templateFillToggle.checked = false;
}

clearBtn.addEventListener("click", () => {
  resetResults();
  fileInput.value = "";
  crossFilesInput.value = "";
  setStatus("Cleared. Ready.", "info");
});

function renderTranslatedDoc(data) {
  const t = data?.translated_text ?? "";
  translatedDocEl.classList.remove("subtle");
  translatedDocEl.innerHTML = t
    ? `<pre class="doc">${escapeHtml(t)}</pre>`
    : `<p class="subtle">No translated text in response.</p>`;
  if (t) translatedDisclosure.open = true;
}

function renderSummary(data) {
  const summary = data?.summary ?? "";
  summaryEl.classList.remove("subtle");
  summaryEl.innerHTML = summary
    ? `<p>${escapeHtml(summary)}</p>`
    : `<p class="subtle">No summary in response.</p>`;
}

function renderKeyPoints(data) {
  const items = normalizeArray(data?.key_points ?? []);
  keyPointsEl.classList.remove("subtle");

  if (!items.length) {
    keyPointsEl.innerHTML = `<p class="subtle">No key points in response.</p>`;
    return;
  }

  keyPointsEl.innerHTML = items.map((kp) => {
    const text = kp?.point ?? "";
    const dept = kp?.department ?? "";
    const tags = normalizeArray(kp?.tags).filter(Boolean);
    const deptLabel = DEPARTMENTS.includes(dept) ? dept : "Unassigned";

    return `
      <div class="kp">
        <div class="kp-top">
          <span class="badge">${escapeHtml(deptLabel)}</span>
          ${
            tags.length
              ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
              : `<span class="subtle">No tags</span>`
          }
        </div>
        <div>${text ? escapeHtml(text) : "<span class='subtle'>No text</span>"}</div>
      </div>
    `;
  }).join("");
}

function renderTodos(data) {
  const byDeptObj = data?.todos_by_department ?? null;
  todosEl.classList.remove("subtle");

  if (!byDeptObj || typeof byDeptObj !== "object" || Array.isArray(byDeptObj)) {
    todosEl.innerHTML = `<p class="subtle">No to-dos in response.</p>`;
    return;
  }

  todosEl.innerHTML = DEPARTMENTS.map((dept) => {
    const items = normalizeArray(byDeptObj[dept]);
    return `
      <div class="todo-dept">
        <strong>${escapeHtml(dept)}</strong>
        <div style="margin-top:8px;">
          ${items.length ? items.map(renderTodoItem).join("") : `<div class="subtle">No tasks.</div>`}
        </div>
      </div>
    `;
  }).join("");
}

function renderTodoItem(item) {
  const task = item?.task ?? "";
  const source = item?.source_point ?? "";
  return `
    <div class="todo-item">
      <div>${task ? escapeHtml(task) : "<span class='subtle'>No task text</span>"}</div>
      ${source ? `<div class="todo-meta">Source: ${escapeHtml(source)}</div>` : ""}
    </div>
  `;
}

function renderCrossReference(data) {
  const findings = normalizeArray(data?.cross_reference ?? []);
  crossRefEl.classList.remove("subtle");

  if (!findings.length) {
    crossRefEl.innerHTML = `<p class="subtle">No cross-reference output.</p>`;
    return;
  }

  crossRefEl.innerHTML = findings.map((f) => {
    const q = f?.question ?? "";
    const a = f?.answer ?? "";
    const found = f?.found_in ?? "";
    const confidence = f?.confidence ?? "";

    return `
      <div class="kp">
        <div class="kp-top">
          <span class="badge">Cross-reference</span>
          ${found ? `<span class="badge">${escapeHtml(found)}</span>` : ""}
          ${confidence ? `<span class="badge">Confidence: ${escapeHtml(confidence)}</span>` : ""}
        </div>
        <div><strong>Q:</strong> ${escapeHtml(q)}</div>
        <div><strong>A:</strong> ${a ? escapeHtml(a) : "<span class='subtle'>Not found.</span>"}</div>
      </div>
    `;
  }).join("");
}

function renderTemplate(data) {
  const tmpl = data?.response_template ?? "";
  templateBoxEl.classList.remove("subtle");

  originalTemplateText = tmpl || "";
  if (!tmpl) {
    templateBoxEl.innerHTML = `<p class="subtle">No template in response.</p>`;
    return;
  }

  templateBoxEl.innerHTML = `<pre class="doc">${escapeHtml(tmpl)}</pre>`;
}

function applyTemplateFillPreference() {
  if (!lastResult || !originalTemplateText) return;

  // For now, the backend already tries to use cross-reference data when it can.
  // The toggle is a user hint/flag; we keep the content the same.
  // You can extend this later to modify placeholders client-side.
  templateBoxEl.innerHTML = `<pre class="doc">${escapeHtml(originalTemplateText)}</pre>`;
}

templateFillToggle.addEventListener("change", () => {
  applyTemplateFillPreference();
});

async function safeReadError(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json().catch(() => null);
    return j?.error || j?.message || JSON.stringify(j);
  }
  return await res.text().catch(() => "Unknown error");
}

// Export helpers

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportTranslationDocx() {
  if (!lastResult || !lastResult.translated_text) {
    setStatus("No translated text to export.", "warn");
    return;
  }
  const html = `<html><body><pre>${escapeHtml(lastResult.translated_text)}</pre></body></html>`;
  downloadBlob(html, "translation.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

function exportTodosCsv() {
  if (!lastResult || !lastResult.todos_by_department) {
    setStatus("No to-dos to export.", "warn");
    return;
  }

  const rows = [["department", "task", "source_point"]];
  for (const dept of DEPARTMENTS) {
    const items = normalizeArray(lastResult.todos_by_department[dept]);
    for (const item of items) {
      const task = item?.task ?? "";
      const source = item?.source_point ?? "";
      rows.push([
        dept,
        task.replaceAll('"', '""'),
        source.replaceAll('"', '""')
      ]);
    }
  }

  const csv = rows
    .map(r => r.map(v => `"${v}"`).join(","))
    .join("\n");

  downloadBlob(csv, "todos.csv", "text/csv;charset=utf-8;");
}

function exportTemplateDocx() {
  if (!lastResult || !originalTemplateText) {
    setStatus("No template to export.", "warn");
    return;
  }
  const html = `<html><body><pre>${escapeHtml(originalTemplateText)}</pre></body></html>`;
  downloadBlob(html, "response-template.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

exportTranslationBtn.addEventListener("click", exportTranslationDocx);
exportTodosBtn.addEventListener("click", exportTodosCsv);
exportTemplateBtn.addEventListener("click", exportTemplateDocx);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("Choose a PDF or DOCX file first.", "warn");
    return;
  }

  const outputs = getSelectedOutputs();
  if (outputs.length < 1) {
    setStatus("Choose at least one output.", "warn");
    return;
  }

  const wantsCrossRef = outputs.includes("cross_reference") || outputs.includes("generate_template");

  analyzeBtn.disabled = true;
  resetResults();
  setStatus("Uploading and analyzing...", "info");

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("targetLanguage", translateTo.value);
    outputs.forEach(o => fd.append("outputs", o));

    if (wantsCrossRef) {
      const crossFiles = [...(crossFilesInput?.files || [])];
      crossFiles.forEach(f => fd.append("crossFiles", f));
    }

    const res = await fetch(ENDPOINT, { method: "POST", body: fd });

    if (!res.ok) {
      const details = await safeReadError(res);
      setStatus(`Request failed (${res.status}). ${details || ""}`.trim(), "bad");
      return;
    }

    const data = await res.json();
    lastResult = data;

    setStatus("Done.", "good");

    if (outputs.includes("translation")) renderTranslatedDoc(data);
    else translatedDocEl.innerHTML = `<p class="subtle">Not requested.</p>`;

    if (outputs.includes("summary")) renderSummary(data);
    else summaryEl.innerHTML = `<p class="subtle">Not requested.</p>`;

    if (outputs.includes("key_points")) renderKeyPoints(data);
    else keyPointsEl.innerHTML = `<p class="subtle">Not requested.</p>`;

    if (outputs.includes("todos")) renderTodos(data);
    else todosEl.innerHTML = `<p class="subtle">Not requested.</p>`;

    if (outputs.includes("cross_reference")) renderCrossReference(data);
    else crossRefEl.innerHTML = `<p class="subtle">Not requested.</p>`;

    if (outputs.includes("generate_template")) renderTemplate(data);
    else templateBoxEl.innerHTML = `<p class="subtle">Not requested.</p>`;
  } catch (err) {
    setStatus(`Network error: ${err?.message || String(err)}`, "bad");
  } finally {
    updateAnalyzeEnabled(false);
  }
});
