// ══════════════════════════════════════════════════════
//  GeoSnap — frontend controller
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

// ── Globe setup ─────────────────────────────────────────
let globe = null;
let pins = [];           // [{lat, lon, color, label, id}]
let activeId = null;

function initGlobe() {
  const el = $("globe-el");
  const rect = el.getBoundingClientRect();

  globe = Globe({ animateIn: true })(el)
    .width(rect.width || 900)
    .height(rect.height || 700)
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
    .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
    // points = location pins
    .pointsData(pins)
    .pointLat("lat")
    .pointLng("lon")
    .pointColor("color")
    .pointAltitude(0.02)
    .pointRadius(d => d.id === activeId ? 0.7 : 0.45)
    .pointLabel(d => `
      <div style="background:#fff;border:1px solid #e4e4ef;border-radius:10px;
        padding:8px 12px;box-shadow:0 4px 20px rgba(0,0,0,.15);font-family:Inter,sans-serif">
        <div style="font-weight:700;font-size:13px;color:#1a1a2e">${d.label}</div>
        <div style="font-size:11px;color:#6b6b8a;margin-top:3px">${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}</div>
        <div style="font-size:11px;margin-top:4px">
          <span style="background:${d.color}22;color:${d.color};font-weight:700;
            padding:1px 7px;border-radius:999px;text-transform:uppercase;font-size:9px">${d.source}</span>
        </div>
      </div>`)
    .onPointClick(d => zoomToPin(d))
    // rings for active pin
    .ringsData([])
    .ringLat("lat")
    .ringLng("lon")
    .ringColor(() => "#6d28d9")
    .ringAltitude(0.01)
    .ringMaxRadius(3)
    .ringPropagationSpeed(1.5)
    .ringRepeatPeriod(800);

  // atmosphere
  globe.atmosphereColor("#c9c9e0").atmosphereAltitude(0.15);

  // resize observer
  new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    globe.width(r.width).height(r.height);
  }).observe(el);
}

function refreshGlobe() {
  if (!globe) return;
  globe.pointsData([...pins]);
  const active = pins.find(p => p.id === activeId);
  globe.ringsData(active ? [active] : []);
}

function addPin(record) {
  if (!record.lat || !record.lon) return;
  const existing = pins.findIndex(p => p.id === record.id);
  const pin = {
    id: record.id,
    lat: record.lat,
    lon: record.lon,
    color: record.color || "#6d28d9",
    label: [record.landmark, record.city, record.country].filter(Boolean).join(", ") || "Unknown",
    source: record.source === "exif_gps" ? "GPS" : "AI",
  };
  if (existing >= 0) pins[existing] = pin;
  else pins.unshift(pin);
  refreshGlobe();
}

function zoomToPin(pin) {
  activeId = pin.id;
  refreshGlobe();
  globe.pointOfView({ lat: pin.lat, lng: pin.lon, altitude: 1.4 }, 900);
}

// ── Stats ───────────────────────────────────────────────
function updateStats(stats) {
  if (!stats) return;
  $("stat-total").textContent = stats.total ?? 0;
  $("stat-gps").textContent = stats.gps ?? 0;
  $("stat-vision").textContent = stats.vision ?? 0;
  $("stat-countries").textContent = stats.countries ?? 0;
}

// ── History list ────────────────────────────────────────
function renderHistory(records) {
  const list = $("history-list");
  if (!records.length) {
    list.innerHTML = '<div class="history-empty">No images analyzed yet.<br>Upload one to begin.</div>';
    return;
  }
  list.innerHTML = "";
  records.forEach(r => {
    const place = [r.landmark, r.city, r.country].filter(Boolean).join(", ") || "Unknown location";
    const isGps = r.source === "exif_gps";
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="h-dot" style="background:${r.color || '#6b6b8a'}"></div>
      <div class="h-info">
        <div class="h-place">${place}</div>
        <div class="h-meta">${r.analyzed_at ? r.analyzed_at.replace("T", " ").slice(0, 16) : ""} · ${r.filename || ""}</div>
      </div>
      <span class="h-src ${isGps ? 'gps' : 'vision'}">${isGps ? 'GPS' : 'AI'}</span>`;
    item.onclick = () => {
      renderResult(r);
      if (r.lat && r.lon) {
        activeId = r.id;
        refreshGlobe();
        globe.pointOfView({ lat: r.lat, lng: r.lon, altitude: 1.4 }, 900);
      }
    };
    list.appendChild(item);
  });
}

// ── Result card ─────────────────────────────────────────
function renderResult(r) {
  $("result-card").hidden = false;
  $("analyzing-card").hidden = true;

  const place = [r.landmark, r.city, r.country].filter(Boolean).join(", ") || "Unknown location";
  $("result-place").textContent = place;
  $("result-pin").style.background = `${r.color || "#6d28d9"}20`;
  $("result-pin").style.color = r.color || "#6d28d9";
  $("result-coords").textContent = r.lat && r.lon
    ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`
    : "No coordinates";

  const isGps = r.source === "exif_gps";
  const badge = $("conf-badge");
  badge.textContent = isGps ? "GPS Exact" : `${r.confidence_pct}% ${r.confidence}`;
  badge.className = "conf-badge " + (isGps ? "gps" : r.confidence);
  $("result-source").textContent = isGps
    ? "Source: EXIF GPS metadata"
    : `Source: llama3.2-vision · ${r.place?.display_name?.slice(0, 60) || ""}`;

  const clues = $("clues-list");
  clues.innerHTML = "";
  (r.clues || []).forEach(c => {
    const d = document.createElement("div");
    d.className = "clue-item"; d.textContent = c;
    clues.appendChild(d);
  });

  const rbox = $("reasoning-box");
  if (r.reasoning) {
    rbox.hidden = false;
    rbox.textContent = r.reasoning;
    rbox.title = "Click to expand";
  } else {
    rbox.hidden = true;
  }

  const egrid = $("exif-grid");
  egrid.innerHTML = "";
  const fields = [
    ["Camera", r.camera],
    ["Timestamp", r.timestamp?.slice(0, 16)],
    ["Resolution", r.width && r.height ? `${r.width}×${r.height}` : null],
    ["Altitude", r.altitude ? `${r.altitude}m` : null],
    ["Country code", r.place?.country_code],
    ["Postcode", r.place?.postcode],
  ].filter(([, v]) => v);
  fields.forEach(([label, val]) => {
    egrid.innerHTML += `<div class="exif-item"><div class="exif-label">${label}</div><div class="exif-val">${val}</div></div>`;
  });
}

// ── Upload & analyze ────────────────────────────────────
async function analyzeFile(file) {
  if (!file || !file.type.startsWith("image/")) return;

  $("result-card").hidden = true;
  $("analyzing-card").hidden = false;
  $("analyzing-text").textContent = "Reading metadata…";

  const fd = new FormData();
  fd.append("file", file);

  try {
    const resp = await fetch("/api/analyze", { method: "POST", body: fd });
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let exifData = {};

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "status") $("analyzing-text").textContent = evt.msg;
          else if (evt.type === "exif") exifData = evt;
          else if (evt.type === "error") {
            $("analyzing-card").hidden = true;
            alert("Error: " + evt.msg);
          } else if (evt.type === "result") {
            const record = { ...evt, ...exifData };
            renderResult(record);
            addPin(evt);
            await loadHistory();
          } else if (evt.type === "done") {
            $("analyzing-card").hidden = true;
          }
        } catch { /* skip bad line */ }
      }
    }
  } catch (err) {
    $("analyzing-card").hidden = true;
    alert("Connection error: " + err.message);
  }
}

async function loadHistory() {
  const records = await fetch("/api/history").then(r => r.json());
  renderHistory(records);
  // add pins for all records that have coords
  pins = [];
  records.forEach(r => { if (r.lat && r.lon) addPin(r); });
  refreshGlobe();
  // update stats from health
  const health = await fetch("/api/health").then(r => r.json());
  updateStats(health.stats);
  const badge = $("model-badge");
  if (health.vision_ready) {
    badge.classList.add("ready");
    $("model-name").textContent = health.vision_model;
  } else {
    badge.classList.remove("ready");
    $("model-name").textContent = "model loading…";
  }
}

// ── Wire events ─────────────────────────────────────────
$("file-input").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) analyzeFile(f);
});

$("clear-btn").addEventListener("click", async () => {
  await fetch("/api/clear", { method: "POST" });
  pins = []; refreshGlobe();
  await loadHistory();
});

// drag-and-drop
document.addEventListener("dragenter", () => $("drop-overlay").classList.add("active"));
document.addEventListener("dragleave", e => { if (!e.relatedTarget) $("drop-overlay").classList.remove("active"); });
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  e.preventDefault();
  $("drop-overlay").classList.remove("active");
  const f = e.dataTransfer?.files[0];
  if (f && f.type.startsWith("image/")) analyzeFile(f);
});

// ── Boot ─────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  initGlobe();
  await loadHistory();
  // rotate globe slowly at start
  if (globe) {
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.5;
  }
  // stop autorotate on interaction
  $("globe-el").addEventListener("pointerdown", () => {
    if (globe) globe.controls().autoRotate = false;
  });
});
