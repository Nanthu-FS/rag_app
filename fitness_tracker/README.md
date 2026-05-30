# Vital — AI Body & Fitness Tracker

A glassmorphic wellness app: enter your body stats, AI sets your ideal targets,
then log meals, water, and workouts against them. Styled after a frosted-glass
mobile concept (thin numerals, squircle cards, calorie ring gauge).

## Stack

| Layer | Tech |
|-------|------|
| UI | Single-page `web/index.html` + `app.js` (no framework, no build) |
| Persistence | **Supabase** (Postgres) via `store.js`, with automatic **localStorage fallback** |
| AI coaching | **Ollama** `llama3.2:3b` — narrative assessment, workout & meal suggestions |
| Food data | **OpenFoodFacts** live search, proxied server-side |
| Server | `server.py` — stdlib only (Python 3.10), no pip installs |

The server is stateless: it computes sports-science metrics, calls Ollama, and
proxies OpenFoodFacts (server-side to dodge CORS). All user data lives in Supabase
or the browser.

## What it does

- **Profile → AI targets:** BMI, BMR (Mifflin-St Jeor), TDEE, goal-adjusted daily
  calories, protein/carb/fat macros, water target, and a healthy weight range —
  plus an Ollama-written coaching summary, 3 workout suggestions, and 3 meal tips.
- **Calorie ring:** intake vs. target, net of calories burned.
- **Meals:** breakfast / lunch / dinner with recommended kcal split (30/40/30).
  Search OpenFoodFacts (real macros) or add a custom food; serving size in grams
  auto-computes calories and macros.
- **Water:** tap-to-fill glasses against your hydration target.
- **Workouts:** log name / minutes / kcal, with one-tap AI suggestions.

## Run

```powershell
python fitness_tracker\server.py
# -> http://127.0.0.1:8840
```

Requires [Ollama](https://ollama.com) running with the model pulled:

```powershell
ollama pull llama3.2:3b
```

If Ollama is offline the app still works — targets are computed deterministically
and the coaching falls back to a sensible template.

## Connect Supabase (optional but recommended)

The app runs on `localStorage` out of the box (the badge at the top shows
`STORAGE: LOCAL`). To persist to the cloud:

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [`schema.sql`](schema.sql) in the Supabase SQL editor.
3. Copy `web/config.example.js` to `web/config.js`, then paste your Project URL +
   anon key into it. (`config.js` is gitignored so your keys never get committed.)
4. Reload — the badge flips to `STORAGE: SUPABASE`.

> The schema ships with permissive anon RLS for single-user local use. Tighten the
> policies before any multi-user deployment.
