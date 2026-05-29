// ════════════════════════════════════════════════════════════════════════
//  Nimbus Triage — frontend controller
// ════════════════════════════════════════════════════════════════════════
const AGENTS = {
  billing:   { name: "Billing Desk",   emoji: "💳", color: "var(--billing)",   sub: "Ava · billing specialist" },
  technical: { name: "Technical Desk", emoji: "🛠️", color: "var(--technical)", sub: "Max · support engineer" },
  general:   { name: "General Desk",   emoji: "💬", color: "var(--general)",   sub: "Sam · support agent" },
  human:     { name: "Human Escalation", emoji: "🚨", color: "var(--human)",   sub: "Routed to a specialist" },
};
const STEPS = ["classify", "retrieve", "gate", "respond"];

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const inputEl = $("input");
const sendBtn = $("send");

const history = [];   // [{role, content}]
let streaming = false;

// ── helpers ───────────────────────────────────────────────────────────────
function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function renderMarkdown(text) {
  // tiny, safe-ish markdown: escape then apply a few inline rules
  let h = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bullet lists
  h = h.replace(/(?:^|\n)([-*] .+(?:\n[-*] .+)*)/g, (m, block) => {
    const items = block.trim().split("\n").map(l => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
    return `\n<ul>${items}</ul>`;
  });
  return h.split(/\n{2,}/).map(p => p.match(/^<ul>/) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `<div class="avatar">🧑</div><div class="bubble"></div>`;
  el.querySelector(".bubble").textContent = text;
  messagesEl.appendChild(el);
  scrollDown();
}

function addBotMessage() {
  const el = document.createElement("div");
  el.className = "msg bot";
  el.innerHTML = `
    <div class="avatar" data-avatar>◈</div>
    <div class="bot-wrap">
      <span class="agent-tag" data-tag hidden></span>
      <div class="bubble cursor" data-bubble></div>
    </div>`;
  messagesEl.appendChild(el);
  scrollDown();
  return el;
}

function setAgentTag(el, key) {
  const a = AGENTS[key] || AGENTS.general;
  const tag = el.querySelector("[data-tag]");
  tag.hidden = false;
  tag.textContent = `${a.emoji} ${a.name}`;
  tag.style.color = a.color;
  tag.style.background = `color-mix(in srgb, ${a.color} 16%, transparent)`;
  el.querySelector("[data-avatar]").textContent = a.emoji;
}

// ── routing panel ───────────────────────────────────────────────────────
function resetPanel() {
  $("route-state").textContent = "running";
  $("route-state").classList.add("live");
  STEPS.forEach(s => {
    const step = document.querySelector(`.step[data-step="${s}"]`);
    step.classList.remove("active", "done", "warn");
  });
  $("escalation").hidden = true;
  setMeter("conf", null);
  setMeter("cov", null);
  $("cat-name").textContent = "Classifying…";
  $("cat-sub").textContent = "Reading the message";
  $("cat-emoji").textContent = "◈";
  $("category-card").style.borderColor = "var(--border)";
  $("cat-emoji").style.background = "rgba(255,255,255,0.06)";
}

function stepState(name, state) {
  const step = document.querySelector(`.step[data-step="${name}"]`);
  if (!step) return;
  step.classList.remove("active", "done", "warn");
  if (state) step.classList.add(state);
}

function setMeter(kind, value) {
  const bar = $(kind === "conf" ? "conf-bar" : "cov-bar");
  const val = $(kind === "conf" ? "conf-val" : "cov-val");
  if (value === null) { bar.style.width = "0%"; val.textContent = "—"; return; }
  const pct = Math.round(value * 100);
  bar.style.width = pct + "%";
  val.textContent = pct + "%";
}

function setCategory(key, reason) {
  const a = AGENTS[key] || AGENTS.general;
  $("cat-emoji").textContent = a.emoji;
  $("cat-emoji").style.background = `color-mix(in srgb, ${a.color} 22%, transparent)`;
  $("cat-name").textContent = a.name;
  $("cat-sub").textContent = reason || a.sub;
  $("category-card").style.borderColor = `color-mix(in srgb, ${a.color} 45%, transparent)`;
}

// ── main send flow ─────────────────────────────────────────────────────────
async function send(text) {
  if (streaming || !text.trim()) return;
  streaming = true;
  sendBtn.disabled = true;
  $("welcome")?.remove();

  addUserMessage(text);
  history.push({ role: "user", content: text });
  inputEl.value = "";
  inputEl.style.height = "auto";

  resetPanel();
  stepState("classify", "active");

  const botEl = addBotMessage();
  const bubble = botEl.querySelector("[data-bubble]");
  let answer = "";
  let category = "general";
  let escalated = false;
  let sources = [];

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text, history: history.slice(0, -1) }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = JSON.parse(line);
        handleEvent(evt);
      }
    }

    function handleEvent(evt) {
      switch (evt.type) {
        case "classify":
          category = evt.category || "general";
          setCategory(category, evt.reason);
          setMeter("conf", evt.confidence ?? 0);
          stepState("classify", "done");
          stepState("retrieve", "active");
          break;
        case "retrieval":
          sources = evt.sources || [];
          setMeter("cov", evt.retrieval_score ?? 0);
          stepState("retrieve", "done");
          stepState("gate", "active");
          break;
        case "gate":
          escalated = !!evt.escalate;
          if (escalated) {
            stepState("gate", "warn");
            $("escalation").hidden = false;
            $("esc-reason").textContent = evt.reason || "Handing off to a human specialist.";
            setAgentTag(botEl, "human");
            setCategory("human", evt.reason);
          } else {
            stepState("gate", "done");
            setAgentTag(botEl, category);
          }
          stepState("respond", "active");
          break;
        case "token":
          answer += evt.t;
          bubble.innerHTML = renderMarkdown(answer);
          bubble.classList.add("cursor");
          scrollDown();
          break;
        case "done":
          finish();
          break;
      }
    }

    function finish() {
      bubble.classList.remove("cursor");
      bubble.innerHTML = renderMarkdown(answer || "…");
      stepState("respond", escalated ? "warn" : "done");
      $("route-state").textContent = escalated ? "escalated" : "resolved";
      $("route-state").classList.remove("live");
      if (sources.length) attachSources(botEl, sources);
      history.push({ role: "assistant", content: answer });
    }
  } catch (err) {
    bubble.classList.remove("cursor");
    bubble.innerHTML = `<p style="color:var(--human)">⚠️ Connection error: ${err.message}. Is the server running and Ollama up?</p>`;
    $("route-state").textContent = "error";
    $("route-state").classList.remove("live");
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

function attachSources(botEl, sources) {
  const det = document.createElement("details");
  det.className = "sources";
  const sum = document.createElement("summary");
  sum.textContent = ` ${sources.length} knowledge-base source${sources.length > 1 ? "s" : ""}`;
  det.appendChild(sum);
  for (const s of sources) {
    const item = document.createElement("div");
    item.className = "source-item";
    const meta = document.createElement("div");
    meta.className = "src-meta";
    meta.innerHTML = `<b>${s.source}</b><span class="score-pill">${Math.round((s.score || 0) * 100)}% match</span>`;
    const txt = document.createElement("div");
    txt.textContent = (s.snippet || "").slice(0, 280) + ((s.snippet || "").length > 280 ? "…" : "");
    item.appendChild(meta);
    item.appendChild(txt);
    det.appendChild(item);
  }
  botEl.querySelector(".bot-wrap").appendChild(det);
}

// ── events ─────────────────────────────────────────────────────────────────
$("composer").addEventListener("submit", (e) => { e.preventDefault(); send(inputEl.value); });
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
});
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + "px";
});
$("suggestions")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (btn) send(btn.dataset.q);
});

// ── health check ────────────────────────────────────────────────────────────
fetch("/api/health").then(r => r.json()).then(d => {
  const s = $("status");
  s.classList.add("online");
  $("status-text").textContent = `${d.models.answer} · ready`;
}).catch(() => {
  $("status-text").textContent = "offline";
});
