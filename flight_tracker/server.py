"""
Xeno Live Flight Tracker — tiny stdlib-only server.

Serves the static UI and proxies the OpenSky Network API server-side so the
browser never hits a CORS wall. No third-party packages required (Python 3.10).

Optional: set OpenSky OAuth2 client credentials for higher rate limits:
    set OPENSKY_CLIENT_ID=your_id
    set OPENSKY_CLIENT_SECRET=your_secret
Without them it falls back to anonymous access (works, but rate-limited).

Run:  python server.py   ->  http://127.0.0.1:8830
"""
import json
import os
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
PORT = int(os.environ.get("PORT", "8830"))

OPENSKY_STATES = "https://opensky-network.org/api/states/all"
TOKEN_URL = ("https://auth.opensky-network.org/auth/realms/opensky-network/"
             "protocol/openid-connect/token")

REGIONS = {
    "world":  None,
    "europe": (35, -12, 60, 30),
    "nam":    (24, -130, 60, -60),
}

# simple in-process cache so rapid refreshes don't burn the rate limit
_cache = {}          # region -> (timestamp, payload)
_token = {"value": None, "exp": 0}
CACHE_TTL = 8        # seconds


def get_token():
    cid = os.environ.get("OPENSKY_CLIENT_ID")
    secret = os.environ.get("OPENSKY_CLIENT_SECRET")
    if not cid or not secret:
        return None
    if _token["value"] and time.time() < _token["exp"] - 30:
        return _token["value"]
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": secret,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=15) as r:
        tok = json.loads(r.read())
    _token["value"] = tok["access_token"]
    _token["exp"] = time.time() + tok.get("expires_in", 1800)
    return _token["value"]


def fetch_states(region):
    now = time.time()
    cached = _cache.get(region)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    url = OPENSKY_STATES
    bbox = REGIONS.get(region)
    if bbox:
        la, lo, La, Lo = bbox
        url += f"?lamin={la}&lomin={lo}&lamax={La}&lomax={Lo}"

    headers = {"User-Agent": "xeno-flight-tracker"}
    token = get_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        payload = json.loads(r.read())

    _cache[region] = (now, payload)
    return payload


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter console
        pass

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            html = (HERE / "index.html").read_text(encoding="utf-8")
            return self._send(200, html, "text/html; charset=utf-8")

        if path == "/api/flights":
            qs = urllib.parse.parse_qs(parsed.query)
            region = (qs.get("region", ["world"])[0]).lower()
            if region not in REGIONS:
                region = "world"
            try:
                data = fetch_states(region)
                states = [s for s in (data.get("states") or [])
                          if s[5] is not None and s[6] is not None]
                return self._send(200, json.dumps({
                    "time": data.get("time"),
                    "count": len(states),
                    "states": states,
                }))
            except urllib.error.HTTPError as e:
                return self._send(200, json.dumps(
                    {"error": f"opensky {e.code}", "states": []}))
            except Exception as e:
                return self._send(200, json.dumps(
                    {"error": str(e), "states": []}))

        return self._send(404, json.dumps({"error": "not found"}))


if __name__ == "__main__":
    print(f"Xeno Live Flight Tracker  ->  http://127.0.0.1:{PORT}")
    auth = "OAuth2" if os.environ.get("OPENSKY_CLIENT_ID") else "anonymous"
    print(f"OpenSky access: {auth}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
