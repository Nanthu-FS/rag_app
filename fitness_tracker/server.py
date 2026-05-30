"""
Vital — AI body & fitness tracker.  Stdlib-only server (Python 3.10).

Serves the web UI and provides two APIs:
  POST /api/analyze        -> sports-science metrics + Ollama coaching narrative
  GET  /api/food/search    -> OpenFoodFacts proxy (server-side, dodges CORS + sets UA)

Persistence (profile / water / workouts / meals) lives client-side in Supabase
(or localStorage fallback) — this server is stateless.

Run:  python server.py   ->  http://127.0.0.1:8840
Needs Ollama running with llama3.2:3b for AI coaching (falls back gracefully if not).
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # cp1252 console safety

HERE = Path(__file__).parent
WEB = HERE / "web"
PORT = int(os.environ.get("PORT", "8840"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("VITAL_MODEL", "llama3.2:3b")

ACTIVITY = {  # Mifflin-St Jeor activity multipliers
    "sedentary": 1.2, "light": 1.375, "moderate": 1.55,
    "active": 1.725, "athlete": 1.9,
}


# ---------------------------------------------------------------- metrics
def compute_metrics(p):
    sex = p.get("sex", "male")
    age = float(p["age"]);  h = float(p["height_cm"]);  w = float(p["weight_kg"])
    act = p.get("activity", "moderate");  goal = p.get("goal", "maintain")
    m = h / 100.0

    bmi = w / (m * m)
    bmr = 10 * w + 6.25 * h - 5 * age + (5 if sex == "male" else -161)
    tdee = bmr * ACTIVITY.get(act, 1.55)

    target = {"lose": tdee - 500, "gain": tdee + 400}.get(goal, tdee)
    target = max(1200, round(target))

    protein_g = round(1.8 * w)
    fat_g = round(0.25 * target / 9)
    carb_g = max(0, round((target - protein_g * 4 - fat_g * 9) / 4))
    water_ml = round(35 * w)

    ideal_min = round(18.5 * m * m, 1)
    ideal_max = round(24.9 * m * m, 1)
    cat = ("Underweight" if bmi < 18.5 else "Healthy" if bmi < 25
           else "Overweight" if bmi < 30 else "Obese")

    return {
        "bmi": round(bmi, 1), "bmi_category": cat,
        "bmr": round(bmr), "tdee": round(tdee),
        "target_kcal": target,
        "protein_g": protein_g, "carb_g": carb_g, "fat_g": fat_g,
        "water_ml": water_ml, "water_glasses": round(water_ml / 250),
        "ideal_min": ideal_min, "ideal_max": ideal_max,
        "meals": {
            "breakfast": round(target * 0.30),
            "lunch": round(target * 0.40),
            "dinner": round(target * 0.30),
        },
    }


def coach_with_ollama(p, m):
    """Ask Ollama for a short narrative + workout/meal tips. Falls back if down."""
    prompt = f"""You are a concise, encouraging fitness coach. Given this person's data,
return ONLY valid JSON (no markdown) with this exact shape:
{{"summary": "2-3 sentence plain-language assessment and what to focus on",
  "workouts": [{{"name": "...", "minutes": 30, "kcal": 250}}],
  "meal_tips": ["tip", "tip", "tip"]}}

Person: sex={p.get('sex')}, age={p.get('age')}, height={p.get('height_cm')}cm,
weight={p.get('weight_kg')}kg, activity={p.get('activity')}, goal={p.get('goal')}.
Computed: BMI={m['bmi']} ({m['bmi_category']}), maintenance={m['tdee']} kcal,
daily target={m['target_kcal']} kcal, protein {m['protein_g']}g, healthy weight
range {m['ideal_min']}-{m['ideal_max']} kg.
Give 3 workouts suited to their goal and 3 meal tips. Keep numbers realistic."""

    body = json.dumps({
        "model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "format": "json", "options": {"temperature": 0.4},
    }).encode()
    try:
        req = urllib.request.Request(OLLAMA_URL, data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read())
        out = json.loads(resp.get("response", "{}"))
        return {
            "summary": out.get("summary") or _fallback_summary(p, m),
            "workouts": out.get("workouts") or _fallback_workouts(p),
            "meal_tips": out.get("meal_tips") or _fallback_tips(m),
            "source": "ollama",
        }
    except Exception as e:
        return {
            "summary": _fallback_summary(p, m),
            "workouts": _fallback_workouts(p),
            "meal_tips": _fallback_tips(m),
            "source": f"fallback ({type(e).__name__})",
        }


def _fallback_summary(p, m):
    goal = {"lose": "lose fat", "gain": "build mass"}.get(p.get("goal"), "maintain")
    return (f"Your BMI is {m['bmi']} ({m['bmi_category']}). To {goal}, aim for "
            f"{m['target_kcal']} kcal and {m['protein_g']}g protein daily, and keep "
            f"hydrated with about {m['water_glasses']} glasses of water.")


def _fallback_workouts(p):
    g = p.get("goal")
    if g == "lose":
        return [{"name": "Brisk walk / incline", "minutes": 40, "kcal": 300},
                {"name": "HIIT circuit", "minutes": 20, "kcal": 250},
                {"name": "Full-body strength", "minutes": 35, "kcal": 220}]
    if g == "gain":
        return [{"name": "Push (chest/shoulders)", "minutes": 45, "kcal": 280},
                {"name": "Pull (back/biceps)", "minutes": 45, "kcal": 280},
                {"name": "Legs (squat focus)", "minutes": 50, "kcal": 320}]
    return [{"name": "Zone-2 cardio", "minutes": 35, "kcal": 280},
            {"name": "Mobility + core", "minutes": 25, "kcal": 150},
            {"name": "Strength full-body", "minutes": 40, "kcal": 260}]


def _fallback_tips(m):
    return [f"Hit ~{m['protein_g']}g protein — lean meat, eggs, legumes, dairy.",
            f"Front-load calories: ~{m['meals']['breakfast']} kcal at breakfast.",
            "Favor whole foods and fibre; limit liquid calories and ultra-processed snacks."]


# ---------------------------------------------------------------- food
def search_food(q):
    url = ("https://world.openfoodfacts.org/cgi/search.pl?"
           + urllib.parse.urlencode({
               "search_terms": q, "search_simple": 1, "action": "process",
               "json": 1, "page_size": 20,
               "fields": "product_name,brands,nutriments,serving_size",
           }))
    req = urllib.request.Request(url, headers={"User-Agent": "Vital-FitnessTracker/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())

    out = []
    for prod in data.get("products", []):
        name = (prod.get("product_name") or "").strip()
        if not name:
            continue
        n = prod.get("nutriments", {})
        kcal = n.get("energy-kcal_100g")
        if kcal is None and n.get("energy_100g") is not None:
            kcal = round(n["energy_100g"] / 4.184, 1)
        if not kcal:
            continue
        out.append({
            "name": name[:60],
            "brand": (prod.get("brands") or "").split(",")[0][:30],
            "kcal100": round(float(kcal), 1),
            "protein100": round(float(n.get("proteins_100g", 0) or 0), 1),
            "carb100": round(float(n.get("carbohydrates_100g", 0) or 0), 1),
            "fat100": round(float(n.get("fat_100g", 0) or 0), 1),
            "serving": prod.get("serving_size") or "",
        })
        if len(out) >= 15:
            break
    return out


# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, name, ctype):
        f = WEB / name
        if not f.exists():
            return self._send(404, {"error": "not found"})
        self._send(200, f.read_bytes(), ctype)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path in ("/", "/index.html"):
            return self._serve_file("index.html", "text/html; charset=utf-8")
        if path.endswith(".js"):
            return self._serve_file(path.lstrip("/"), "application/javascript")
        if path.endswith(".css"):
            return self._serve_file(path.lstrip("/"), "text/css")
        if path == "/api/food/search":
            qs = urllib.parse.parse_qs(parsed.query)
            q = (qs.get("q", [""])[0]).strip()
            if not q:
                return self._send(200, {"results": []})
            try:
                return self._send(200, {"results": search_food(q)})
            except Exception as e:
                return self._send(200, {"results": [], "error": str(e)})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/analyze":
            length = int(self.headers.get("Content-Length", 0))
            try:
                p = json.loads(self.rfile.read(length) or "{}")
                m = compute_metrics(p)
                coach = coach_with_ollama(p, m)
                return self._send(200, {"metrics": m, "coach": coach})
            except KeyError as e:
                return self._send(400, {"error": f"missing field {e}"})
            except Exception as e:
                return self._send(500, {"error": str(e)})
        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"Vital fitness tracker  ->  http://127.0.0.1:{PORT}")
    print(f"AI coach via Ollama model: {OLLAMA_MODEL} (graceful fallback if offline)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
