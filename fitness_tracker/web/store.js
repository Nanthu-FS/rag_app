// Data layer — talks to Supabase when config.js has keys, otherwise localStorage.
// Same async API either way, so app.js never branches on the backend.

const Store = (() => {
  const cfg = window.VITAL_CONFIG || {};
  const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  let sb = null;
  if (useSupabase && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const backend = () => (sb ? "supabase" : "local");

  // ---------- localStorage helpers ----------
  const LS = {
    get(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  };
  const uid = () => "x" + Math.abs(Date.now() ^ (performance.now() * 1000 | 0)).toString(36);

  // ---------- profile ----------
  async function getProfile() {
    if (sb) {
      const { data } = await sb.from("profiles").select("*")
        .order("updated_at", { ascending: false }).limit(1);
      return (data && data[0]) || null;
    }
    return LS.get("vital_profile", null);
  }
  async function saveProfile(p) {
    const row = { ...p, updated_at: new Date().toISOString() };
    if (sb) {
      const existing = await getProfile();
      if (existing) {
        const { data } = await sb.from("profiles").update(row)
          .eq("id", existing.id).select().single();
        return data;
      }
      const { data } = await sb.from("profiles").insert(row).select().single();
      return data;
    }
    if (!row.id) row.id = uid();
    LS.set("vital_profile", row);
    return row;
  }

  // ---------- water ----------
  async function getWater(pid) {
    const d = today();
    if (sb) {
      const { data } = await sb.from("water_logs").select("*")
        .eq("profile_id", pid).eq("log_date", d).maybeSingle();
      return data ? data.glasses : 0;
    }
    return LS.get(`vital_water_${d}`, 0);
  }
  async function setWater(pid, glasses) {
    const d = today();
    glasses = Math.max(0, glasses);
    if (sb) {
      await sb.from("water_logs")
        .upsert({ profile_id: pid, log_date: d, glasses },
                { onConflict: "profile_id,log_date" });
      return glasses;
    }
    LS.set(`vital_water_${d}`, glasses);
    return glasses;
  }

  // ---------- workouts ----------
  async function listWorkouts(pid) {
    const d = today();
    if (sb) {
      const { data } = await sb.from("workouts").select("*")
        .eq("profile_id", pid).eq("log_date", d)
        .order("created_at", { ascending: false });
      return data || [];
    }
    return LS.get(`vital_workouts_${d}`, []);
  }
  async function addWorkout(pid, w) {
    const d = today();
    const row = { profile_id: pid, log_date: d, ...w };
    if (sb) {
      const { data } = await sb.from("workouts").insert(row).select().single();
      return data;
    }
    row.id = uid(); row.created_at = new Date().toISOString();
    const all = LS.get(`vital_workouts_${d}`, []); all.unshift(row);
    LS.set(`vital_workouts_${d}`, all);
    return row;
  }
  async function deleteWorkout(id) {
    const d = today();
    if (sb) { await sb.from("workouts").delete().eq("id", id); return; }
    LS.set(`vital_workouts_${d}`, LS.get(`vital_workouts_${d}`, []).filter(x => x.id !== id));
  }

  // ---------- meals ----------
  async function listMeals(pid) {
    const d = today();
    if (sb) {
      const { data } = await sb.from("meals").select("*")
        .eq("profile_id", pid).eq("log_date", d)
        .order("created_at", { ascending: true });
      return data || [];
    }
    return LS.get(`vital_meals_${d}`, []);
  }
  async function addMeal(pid, meal) {
    const d = today();
    const row = { profile_id: pid, log_date: d, ...meal };
    if (sb) {
      const { data } = await sb.from("meals").insert(row).select().single();
      return data;
    }
    row.id = uid(); row.created_at = new Date().toISOString();
    const all = LS.get(`vital_meals_${d}`, []); all.push(row);
    LS.set(`vital_meals_${d}`, all);
    return row;
  }
  async function deleteMeal(id) {
    const d = today();
    if (sb) { await sb.from("meals").delete().eq("id", id); return; }
    LS.set(`vital_meals_${d}`, LS.get(`vital_meals_${d}`, []).filter(x => x.id !== id));
  }

  return { backend, today, getProfile, saveProfile, getWater, setWater,
           listWorkouts, addWorkout, deleteWorkout,
           listMeals, addMeal, deleteMeal };
})();
