// Vital — UI logic. Persistence via Store (Supabase or localStorage); AI + food via server.

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n) => Math.round(n).toLocaleString();

let profile = null;     // includes .metrics and .coach
let meals = [];
let workouts = [];
let water = 0;
let activeSlot = "breakfast";

const MEAL_SLOTS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

// ---------- segmented controls ----------
function wireSeg(id, def) {
  const el = $(id);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    el.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
  });
  return {
    get: () => (el.querySelector("button.on") || el.querySelector("button")).dataset.v,
    set: (v) => el.querySelectorAll("button").forEach((x) =>
      x.classList.toggle("on", x.dataset.v === v)),
  };
}
const segSex = wireSeg("#f-sex", "male");
const segAct = wireSeg("#f-activity", "moderate");
const segGoal = wireSeg("#f-goal", "maintain");

// ---------- analyze / onboarding ----------
async function analyze() {
  const p = {
    name: $("#f-name").value.trim() || "You",
    sex: segSex.get(), age: +$("#f-age").value,
    height_cm: +$("#f-height").value, weight_kg: +$("#f-weight").value,
    activity: segAct.get(), goal: segGoal.get(),
  };
  if (!p.age || !p.height_cm || !p.weight_kg) {
    $("#onboardNote").textContent = "Please fill age, height and weight.";
    return;
  }
  const btn = $("#analyzeBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Analyzing with AI…';
  $("#onboardNote").textContent = "";
  try {
    const res = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    p.metrics = data.metrics;
    p.coach = data.coach;
    if (profile && profile.id) p.id = profile.id;
    profile = await Store.saveProfile(p);
    profile.metrics = data.metrics; profile.coach = data.coach; // ensure present
    await loadDay();
    showDash();
  } catch (e) {
    $("#onboardNote").textContent = "Could not analyze: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze with AI";
  }
}

// ---------- screens ----------
function showDash() { $("#onboard").classList.add("hidden"); $("#dash").classList.remove("hidden"); renderDash(); }
function showOnboard() {
  $("#dash").classList.add("hidden"); $("#onboard").classList.remove("hidden");
  if (profile) {
    $("#f-name").value = profile.name || "";
    $("#f-age").value = profile.age || "";
    $("#f-height").value = profile.height_cm || "";
    $("#f-weight").value = profile.weight_kg || "";
    segSex.set(profile.sex); segAct.set(profile.activity); segGoal.set(profile.goal);
  }
}

// ---------- load today's logs ----------
async function loadDay() {
  const pid = profile.id;
  [water, workouts, meals] = await Promise.all([
    Store.getWater(pid), Store.listWorkouts(pid), Store.listMeals(pid),
  ]);
}

// ---------- totals ----------
const mealTotals = () => meals.reduce((a, m) => ({
  kcal: a.kcal + (+m.kcal || 0), protein: a.protein + (+m.protein || 0),
  carb: a.carb + (+m.carb || 0), fat: a.fat + (+m.fat || 0),
}), { kcal: 0, protein: 0, carb: 0, fat: 0 });
const burned = () => workouts.reduce((a, w) => a + (+w.kcal || 0), 0);

// ---------- render dashboard ----------
function renderDash() {
  const m = profile.metrics, c = profile.coach || {};
  $("#d-who").textContent = profile.name;
  $("#d-date").textContent = new Date().toLocaleDateString(undefined,
    { weekday: "long", month: "short", day: "numeric" });
  $("#d-bmi").innerHTML = `${m.bmi} <span>BMI</span>`;
  $("#d-cat").innerHTML = `<span>${m.bmi_category} · ideal ${m.ideal_min}–${m.ideal_max}kg</span>`;

  const t = mealTotals();
  const eaten = t.kcal, net = eaten - burned();
  const remaining = Math.max(0, m.target_kcal - net);
  $("#d-eaten").textContent = fmt(eaten);
  $("#d-target").textContent = `of ${fmt(m.target_kcal)} target`;
  $("#d-remaining").textContent = fmt(remaining);

  // ring fill (intake vs target)
  const pct = Math.min(1, eaten / m.target_kcal);
  $("#ring").setAttribute("stroke-dashoffset", String(628 * (1 - pct)));

  // coach
  $("#d-summary").textContent = c.summary || "—";
  $("#d-tips").innerHTML = (c.meal_tips || []).map((x) => `<span class="pill">${esc(x)}</span>`).join("");

  // macros
  $("#d-macros").innerHTML = [
    ["Protein", t.protein, m.protein_g, "g"],
    ["Carbs", t.carb, m.carb_g, "g"],
    ["Fat", t.fat, m.fat_g, "g"],
  ].map(([lbl, cur, goal, u]) => {
    const p = Math.min(100, goal ? (cur / goal) * 100 : 0);
    return `<div class="macro">
      <div class="label"><span>${lbl}</span><span>${Math.round(cur)}/${goal}${u}</span></div>
      <div class="bar"><i style="width:${p}%"></i></div></div>`;
  }).join("");

  // water
  $("#w-target").textContent = m.water_glasses;
  renderWater();

  // workouts
  $("#d-workouts").innerHTML = workouts.length ? workouts.map((w) => `
    <div class="item"><span>${esc(w.name)} <small>· ${w.minutes}m</small></span>
      <span>${w.kcal} kcal <span class="x" data-del-wk="${w.id}">×</span></span></div>`).join("")
    : `<div class="muted-note">No workouts logged yet.</div>`;
  $("#d-burned").textContent = `${fmt(burned())} kcal`;

  renderMeals();
}

function renderWater() {
  const target = profile.metrics.water_glasses;
  $("#w-count").textContent = water;
  let html = "";
  for (let i = 0; i < target; i++)
    html += `<div class="glass ${i < water ? "full" : ""}" data-glass="${i}"></div>`;
  $("#w-glasses").innerHTML = html;
}

function renderMeals() {
  const m = profile.metrics;
  $("#d-meals").innerHTML = MEAL_SLOTS.map(({ key, label }) => {
    const items = meals.filter((x) => x.slot === key);
    const sum = items.reduce((a, x) => a + (+x.kcal || 0), 0);
    const rec = m.meals[key];
    const rows = items.map((x) => `
      <div class="item"><span>${esc(x.food_name)} <small>· ${Math.round(x.grams)}g</small></span>
        <span>${Math.round(x.kcal)} kcal <span class="x" data-del-meal="${x.id}">×</span></span></div>`).join("");
    return `<div class="card" style="margin-bottom:14px">
      <div class="meal-head">
        <div class="h-title">${label}</div>
        <div class="add-link" data-add-meal="${key}">+ Add food</div>
      </div>
      <div><span class="meal-kcal-big thin">${Math.round(sum)}</span>
        <span class="label">/ ${rec} kcal recommended</span></div>
      <div style="margin-top:8px">${rows || '<div class="muted-note">Nothing logged.</div>'}</div>
    </div>`;
  }).join("");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- water actions ----------
async function changeWater(delta) {
  water = Math.max(0, Math.min(profile.metrics.water_glasses + 4, water + delta));
  renderWater(); $("#w-count").textContent = water;
  water = await Store.setWater(profile.id, water);
}

// ---------- meals: food modal ----------
let pendingFood = null;
function openFood(slot) {
  activeSlot = slot;
  $("#foodTitle").textContent = `Add to ${slot}`;
  $("#foodResults").innerHTML = "";
  $("#foodQuery").value = "";
  $("#foodModal").classList.remove("hidden");
  setTimeout(() => $("#foodQuery").focus(), 50);
}
async function searchFood() {
  const q = $("#foodQuery").value.trim();
  if (!q) return;
  $("#foodResults").innerHTML = '<div class="muted-note"><span class="spin" style="border-top-color:#5b8fb9;border-color:#cdd"></span> Searching…</div>';
  try {
    const res = await fetch("/api/food/search?q=" + encodeURIComponent(q));
    const { results } = await res.json();
    if (!results || !results.length) {
      $("#foodResults").innerHTML = `<div class="muted-note">No matches. <span class="add-link" id="customAdd">Add "${esc(q)}" as custom →</span></div>`;
      $("#customAdd")?.addEventListener("click", () => openQty({
        name: q, brand: "custom", kcal100: 0, protein100: 0, carb100: 0, fat100: 0,
      }));
      return;
    }
    $("#foodResults").innerHTML = results.map((f, i) => `
      <div class="food" data-i="${i}">
        <div><div class="fn">${esc(f.name)}</div>
          <div class="fm">${esc(f.brand || "")} · ${f.protein100}P ${f.carb100}C ${f.fat100}F /100g</div></div>
        <div class="fk">${f.kcal100} <span class="label">kcal</span></div>
      </div>`).join("")
      + `<div class="muted-note"><span class="add-link" id="customAdd">+ Add a custom food instead</span></div>`;
    $$("#foodResults .food").forEach((el) =>
      el.addEventListener("click", () => openQty(results[+el.dataset.i])));
    $("#customAdd")?.addEventListener("click", () => openQty({
      name: q, brand: "custom", kcal100: 0, protein100: 0, carb100: 0, fat100: 0,
    }));
  } catch (e) {
    $("#foodResults").innerHTML = `<div class="muted-note">Search failed: ${esc(e.message)}</div>`;
  }
}

function openQty(food) {
  pendingFood = food;
  const isCustom = !food.kcal100;
  $("#qtyName").textContent = food.name;
  $("#qtyPer").textContent = isCustom
    ? "Custom item — enter the values for this serving"
    : `${food.kcal100} kcal per 100g${food.serving ? " · serving " + food.serving : ""}`;
  $("#qtySlot").textContent = activeSlot;
  $("#qtyGrams").value = 100;
  $("#foodModal").classList.add("hidden");
  $("#qtyModal").classList.remove("hidden");
  if (isCustom) {
    // blank, fully user-driven; grams stays informational
    ["#qtyKcal", "#qtyP", "#qtyC", "#qtyF"].forEach((s) => ($(s).value = ""));
  } else {
    recomputeFromGrams();
  }
}
// recompute nutrition from grams using the per-100g values (searched foods)
function recomputeFromGrams() {
  const f = pendingFood;
  if (!f.kcal100) return;            // custom: don't overwrite user input
  const g = +$("#qtyGrams").value || 0, k = g / 100;
  $("#qtyKcal").value = Math.round(f.kcal100 * k);
  $("#qtyP").value = +(f.protein100 * k).toFixed(1);
  $("#qtyC").value = +(f.carb100 * k).toFixed(1);
  $("#qtyF").value = +(f.fat100 * k).toFixed(1);
}
async function confirmAddFood() {
  const f = pendingFood;
  const meal = await Store.addMeal(profile.id, {
    slot: activeSlot, food_name: f.name, grams: +$("#qtyGrams").value || 0,
    kcal: Math.round(+$("#qtyKcal").value || 0),
    protein: +(+$("#qtyP").value || 0).toFixed(1),
    carb: +(+$("#qtyC").value || 0).toFixed(1),
    fat: +(+$("#qtyF").value || 0).toFixed(1),
  });
  meals.push(meal);
  $("#qtyModal").classList.add("hidden");
  renderDash();
}

// ---------- workouts ----------
function openWorkout() {
  const sug = (profile.coach && profile.coach.workouts) || [];
  $("#wk-suggest").innerHTML = sug.length
    ? `<div class="label" style="margin-bottom:6px">AI suggestions — tap to fill</div>`
      + sug.map((w, i) => `<div class="food" data-wk="${i}">
          <div class="fn">${esc(w.name)}</div><div class="fk">${w.minutes}m · ${w.kcal} kcal</div></div>`).join("")
    : "";
  $$("#wk-suggest .food").forEach((el) => el.addEventListener("click", () => {
    const w = sug[+el.dataset.wk];
    $("#wk-name").value = w.name; $("#wk-min").value = w.minutes; $("#wk-kcal").value = w.kcal;
  }));
  $("#wk-name").value = ""; $("#wk-min").value = 30; $("#wk-kcal").value = 250;
  $("#workoutModal").classList.remove("hidden");
}
async function saveWorkout() {
  const name = $("#wk-name").value.trim() || "Workout";
  const w = await Store.addWorkout(profile.id, {
    name, minutes: +$("#wk-min").value || 0, kcal: +$("#wk-kcal").value || 0,
  });
  workouts.unshift(w);
  $("#workoutModal").classList.add("hidden");
  renderDash();
}

// ---------- delegated clicks ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.addMeal) openFood(t.dataset.addMeal);
  if (t.dataset.glass !== undefined) {
    const idx = +t.dataset.glass;
    changeWater(idx + 1 - water > 0 ? (idx + 1 - water) : (idx - water));
  }
  if (t.dataset.delWk) { await Store.deleteWorkout(t.dataset.delWk); workouts = workouts.filter((w) => w.id != t.dataset.delWk); renderDash(); }
  if (t.dataset.delMeal) { await Store.deleteMeal(t.dataset.delMeal); meals = meals.filter((m) => m.id != t.dataset.delMeal); renderDash(); }
});

// ---------- static wiring ----------
$("#analyzeBtn").addEventListener("click", analyze);
$("#editProfile").addEventListener("click", showOnboard);
$("#w-plus").addEventListener("click", () => changeWater(1));
$("#w-minus").addEventListener("click", () => changeWater(-1));
$("#addWorkout").addEventListener("click", openWorkout);
$("#wk-save").addEventListener("click", saveWorkout);
$("#foodClose").addEventListener("click", () => $("#foodModal").classList.add("hidden"));
$("#foodSearchBtn").addEventListener("click", searchFood);
$("#foodQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") searchFood(); });
$("#qtyClose").addEventListener("click", () => $("#qtyModal").classList.add("hidden"));
$("#qtyGrams").addEventListener("input", recomputeFromGrams);
$("#qtyAdd").addEventListener("click", confirmAddFood);
$("#workoutClose").addEventListener("click", () => $("#workoutModal").classList.add("hidden"));

// ---------- boot ----------
(async function boot() {
  $("#backendTag").textContent = "Storage: " + Store.backend();
  profile = await Store.getProfile();
  if (profile && profile.metrics) {
    await loadDay();
    showDash();
  } else {
    showOnboard();
  }
})();
