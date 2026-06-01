"use strict";

const log = document.getElementById("log");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const statusEl = document.getElementById("status");
const reactor = document.getElementById("reactor");
const agentStrip = document.getElementById("agentStrip");
const voiceToggle = document.getElementById("voiceToggle");

let speakReplies = true;
let busy = false;

const AGENT_LABELS = {
  web_search: "🔍 Web",
  calculator: "🧮 Calc",
  science: "🔬 Science",
  tech: "⚙️ Tech",
  general: "💬 General",
};

/* ---------- health check ---------- */
async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const h = await r.json();
    if (h.ollama === "ok") {
      const missing = Object.entries(h.models_present || {})
        .filter(([, present]) => !present)
        .map(([name]) => name);
      if (missing.length) {
        statusEl.textContent = "Model missing: " + missing.join(", ");
        statusEl.className = "status err";
      } else {
        statusEl.textContent = "Online · " + h.brain_model;
        statusEl.className = "status ok";
      }
    } else {
      statusEl.textContent = "Ollama unreachable";
      statusEl.className = "status err";
    }
  } catch {
    statusEl.textContent = "Backend offline";
    statusEl.className = "status err";
  }
}

/* ---------- message bubbles ---------- */
function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return bubble;
}

function addSources(bubble, sources) {
  if (!sources || !sources.length) return;
  const div = document.createElement("div");
  div.className = "sources";
  div.innerHTML =
    "Sources: " +
    sources
      .map((s, i) => `<a href="${s.url}" target="_blank" rel="noopener">[${i + 1}] ${escapeHtml(s.title)}</a>`)
      .join(" · ");
  bubble.appendChild(div);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- agent chips ---------- */
function renderPlan(agents) {
  agentStrip.innerHTML = "";
  const chips = {};
  agents.forEach((name, i) => {
    const chip = document.createElement("div");
    chip.className = "chip active";
    chip.textContent = AGENT_LABELS[name] || name;
    agentStrip.appendChild(chip);
    chips[name] = chip;
    setTimeout(() => chip.classList.add("show"), i * 80);
  });
  return chips;
}

/* ---------- main: ask ---------- */
async function ask(query) {
  if (busy || !query.trim()) return;
  busy = true;
  sendBtn.disabled = true;
  reactor.classList.add("thinking");
  statusEl.textContent = "Thinking…";
  statusEl.className = "status";

  addMessage("user", query);
  input.value = "";

  let chips = {};
  let bubble = null;
  let answer = "";

  try {
    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split("\n\n");
      buffer = frames.pop();

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        handleEvent(event);
      }
    }
  } catch (e) {
    if (!bubble) bubble = addMessage("personal_intelligence", "");
    bubble.textContent = "Apologies, sir — a fault in the connection. (" + e.message + ")";
    statusEl.className = "status err";
  } finally {
    finishCursor(bubble);
    reactor.classList.remove("thinking");
    statusEl.textContent = statusEl.className.includes("err") ? statusEl.textContent : "Online";
    busy = false;
    sendBtn.disabled = false;
    if (speakReplies && answer.trim()) speak(answer);
  }

  function handleEvent(event) {
    switch (event.type) {
      case "plan":
        chips = renderPlan(event.agents);
        break;
      case "agent": {
        const chip = chips[event.name];
        if (chip) chip.className = "chip show " + (event.ok ? "done" : "failed");
        break;
      }
      case "token":
        if (!bubble) {
          bubble = addMessage("personal_intelligence", "");
          bubble.innerHTML = '<span class="text"></span><span class="cursor">▍</span>';
        }
        answer += event.text;
        bubble.querySelector(".text").textContent = answer;
        log.scrollTop = log.scrollHeight;
        break;
      case "done":
        finishCursor(bubble);
        addSources(bubble, event.sources);
        break;
      case "error":
        if (!bubble) bubble = addMessage("personal_intelligence", "");
        bubble.textContent = "Module error: " + event.message;
        break;
    }
  }
}

function finishCursor(bubble) {
  if (bubble) {
    const c = bubble.querySelector(".cursor");
    if (c) c.remove();
  }
}

/* ---------- TTS via Web Speech API (en-GB = Personal Intelligence accent) ---------- */
let gbVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  gbVoice =
    voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|arthur/i.test(v.name)) ||
    voices.find((v) => /en-GB/i.test(v.lang)) ||
    voices.find((v) => /en/i.test(v.lang)) ||
    null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\[\d+\]/g, ""));
  if (gbVoice) u.voice = gbVoice;
  u.rate = 1.02;
  u.pitch = 0.95;
  speechSynthesis.speak(u);
}

/* ---------- push-to-talk (MediaRecorder -> /api/stt) ---------- */
let mediaRecorder = null;
let chunks = [];

async function startRecording() {
  if (busy) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = onRecordingStop;
    mediaRecorder.start();
    micBtn.classList.add("recording");
    statusEl.textContent = "Listening…";
  } catch {
    statusEl.textContent = "Mic access denied";
    statusEl.className = "status err";
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  }
  micBtn.classList.remove("recording");
}

async function onRecordingStop() {
  const blob = new Blob(chunks, { type: "audio/webm" });
  if (!blob.size) return;
  statusEl.textContent = "Transcribing…";
  const form = new FormData();
  form.append("audio", blob, "clip.webm");
  try {
    const r = await fetch("/api/stt", { method: "POST", body: form });
    const data = await r.json();
    if (data.text && data.text.trim()) {
      input.value = data.text.trim();
      ask(data.text.trim());
    } else {
      statusEl.textContent = "Didn't catch that";
    }
  } catch {
    statusEl.textContent = "Transcription failed";
    statusEl.className = "status err";
  }
}

/* ---------- wiring ---------- */
sendBtn.addEventListener("click", () => ask(input.value));
input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(input.value); });

// Push-to-talk: hold the mic button (mouse or touch).
micBtn.addEventListener("mousedown", startRecording);
micBtn.addEventListener("mouseup", stopRecording);
micBtn.addEventListener("mouseleave", () => micBtn.classList.contains("recording") && stopRecording());
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); });

voiceToggle.addEventListener("click", () => {
  speakReplies = !speakReplies;
  voiceToggle.textContent = speakReplies ? "🔊 Voice on" : "🔇 Voice off";
  voiceToggle.classList.toggle("on", speakReplies);
  if (!speakReplies) speechSynthesis.cancel();
});
voiceToggle.classList.add("on");

checkHealth();
setInterval(checkHealth, 30000);
