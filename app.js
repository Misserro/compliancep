// Endpoint - uses relative path for same-origin deployment
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

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const toArr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

function setStatus(msg, kind = "info") {
  statusEl.className = "status" + (kind !== "info" ? ` ${kind}` : "");
  statusEl.textContent = msg;
}

function getSelectedOutputs() {
  return [...outputsWrap.querySelectorAll('input[name="outputs"]:checked')].map(c => c.value);
}

function updateAnalyzeEnabled() {
  const enabled = getSelectedOutputs().length >= 1;
  analyzeBtn.disabled = !enabled;
  if (!enabled) setStatus("Choose at least one output to enable Analyze.", "warn");
  else setStatus("Ready.");
}

outputsWrap.addEventListener("change", updateAnalyzeEnabled);
updateAnalyzeEnabled();

function resetResults() {
  lastResult = null;
  originalTemplateText = "";
  [translatedDocEl, summaryEl, keyPointsEl, todosEl, crossRefEl, templateBoxEl].forEach(el => {
    el.textContent = "No data yet.";
    el.classList.add("subtle");
  });
  templateFillToggle.checked = false;
}

clearBtn.addEventListener("click", () => {
  resetResults();
  fileInput.value = "";
  crossFilesInput.value = "";
  setStatus("Cleared. Ready.");
});

function renderTranslatedDoc(data) {
  const t = data?.translated_text || "";
  translatedDocEl.classList.remove("subtle");
  translatedDocEl.innerHTML = t ? `<pre class="doc">${esc(t)}</pre>` : `<p class="subtle">No translated text.</p>`;
  if (t) translatedDisclosure.open = true;
}

function renderSummary(data) {
  const s = data?.summary || "";
  summaryEl.classList.remove("subtle");
  summaryEl.innerHTML = s ? `<p>${esc(s)}</p>` : `<p class="subtle">No summary.</p>`;
}

function renderKeyPoints(data) {
  const items = toArr(data?.key_points);
  keyPointsEl.classList.remove("subtle");
  if (!items.length) { keyPointsEl.innerHTML = `<p class="subtle">No key points.</p>`; return; }
  keyPointsEl.innerHTML = items.map(kp => {
    const tags = toArr(kp?.tags).filter(Boolean);
    return `<div class="kp"><div class="kp-top"><span class="badge">${esc(kp?.department || "Unassigned")}</span>${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</div><div>${esc(kp?.point || "")}</div></div>`;
  }).join("");
}

function renderTodos(data) {
  const byDept = data?.todos_by_department;
  todosEl.classList.remove("subtle");
  if (!byDept || typeof byDept !== "object") { todosEl.innerHTML = `<p class="subtle">No to-dos.</p>`; return; }
  todosEl.innerHTML = DEPARTMENTS.map(dept => {
    const items = toArr(byDept[dept]);
    return `<div class="todo-dept"><strong>${esc(dept)}</strong><div>${items.length ? items.map(i => `<div class="todo-item"><div>${esc(i?.task || "")}</div>${i?.source_point ? `<div class="todo-meta">Source: ${esc(i.source_point)}</div>` : ""}</div>`).join("") : `<div class="subtle">No tasks.</div>`}</div></div>`;
  }).join("");
}

function renderCrossReference(data) {
  const items = toArr(data?.cross_reference);
  crossRefEl.classList.remove("subtle");
  if (!items.length) { crossRefEl.innerHTML = `<p class="subtle">No cross-reference.</p>`; return; }
  crossRefEl.innerHTML = items.map(f => `<div class="kp"><div class="kp-top"><span class="badge">Cross-ref</span>${f?.found_in ? `<span class="badge">${esc(f.found_in)}</span>` : ""}${f?.confidence ? `<span class="badge">${esc(f.confidence)}</span>` : ""}</div><div><strong>Q:</strong> ${esc(f?.question)}</div><div><strong>A:</strong> ${f?.answer ? esc(f.answer) : "<span class='subtle'>Not found</span>"}</div></div>`).join("");
}

function renderTemplate(data) {
  const t = data?.response_template || "";
  originalTemplateText = t;
  templateBoxEl.classList.remove("subtle");
  templateBoxEl.innerHTML = t ? `<pre class="doc">${esc(t)}</pre>` : `<p class="subtle">No template.</p>`;
}

templateFillToggle.addEventListener("change", () => {
  if (originalTemplateText) templateBoxEl.innerHTML = `<pre class="doc">${esc(originalTemplateText)}</pre>`;
});

function downloadBlob(content, filename, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

exportTranslationBtn.addEventListener("click", () => {
  if (!lastResult?.translated_text) return setStatus("No translation to export.", "warn");
  downloadBlob(`<html><body><pre>${esc(lastResult.translated_text)}</pre></body></html>`, "translation.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

exportTodosBtn.addEventListener("click", () => {
  if (!lastResult?.todos_by_department) return setStatus("No to-dos to export.", "warn");
  const rows = [["department", "task", "source_point"]];
  DEPARTMENTS.forEach(d => toArr(lastResult.todos_by_department[d]).forEach(i => rows.push([d, (i?.task || "").replace(/"/g, '""'), (i?.source_point || "").replace(/"/g, '""')])));
  downloadBlob(rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n"), "todos.csv", "text/csv");
});

exportTemplateBtn.addEventListener("click", () => {
  if (!originalTemplateText) return setStatus("No template to export.", "warn");
  downloadBlob(`<html><body><pre>${esc(originalTemplateText)}</pre></body></html>`, "response-template.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return setStatus("Choose a file first.", "warn");
  const outputs = getSelectedOutputs();
  if (!outputs.length) return setStatus("Choose at least one output.", "warn");

  analyzeBtn.disabled = true;
  resetResults();
  setStatus("Uploading and analyzing…");

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("targetLanguage", translateTo.value);
    outputs.forEach(o => fd.append("outputs", o));
    if (outputs.includes("cross_reference") || outputs.includes("generate_template")) {
      [...(crossFilesInput?.files || [])].forEach(f => fd.append("crossFiles", f));
    }

    const res = await fetch(ENDPOINT, { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return setStatus(`Error ${res.status}: ${err.error || "Unknown"}`, "bad");
    }

    const data = await res.json();
    lastResult = data;
    setStatus("Done.", "good");

    outputs.includes("translation") ? renderTranslatedDoc(data) : (translatedDocEl.innerHTML = `<p class="subtle">Not requested.</p>`);
    outputs.includes("summary") ? renderSummary(data) : (summaryEl.innerHTML = `<p class="subtle">Not requested.</p>`);
    outputs.includes("key_points") ? renderKeyPoints(data) : (keyPointsEl.innerHTML = `<p class="subtle">Not requested.</p>`);
    outputs.includes("todos") ? renderTodos(data) : (todosEl.innerHTML = `<p class="subtle">Not requested.</p>`);
    outputs.includes("cross_reference") ? renderCrossReference(data) : (crossRefEl.innerHTML = `<p class="subtle">Not requested.</p>`);
    outputs.includes("generate_template") ? renderTemplate(data) : (templateBoxEl.innerHTML = `<p class="subtle">Not requested.</p>`);
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "bad");
  } finally {
    updateAnalyzeEnabled();
  }
});
