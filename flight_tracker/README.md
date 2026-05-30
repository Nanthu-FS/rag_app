# Xeno · Live Flight Tracker

A real-time flight tracker styled after the Xeno travel UI. Shows live aircraft
positions on a map with heading, altitude, speed and per-flight telemetry.

- **Live data:** OpenSky Network (real ADS-B aircraft states)
- **Frontend:** single `index.html` — Leaflet map + CARTO light basemap, no build step
- **Backend:** `server.py` — stdlib-only Python proxy (no pip installs). It exists
  to dodge the browser CORS wall: OpenSky blocks direct browser-origin requests,
  so the fetch happens server-side and is relayed to the page.

## Run

```powershell
python flight_tracker\server.py
# -> http://127.0.0.1:8830
```

Uses the Python 3.10 interpreter (see project memory). No dependencies.

## Features

- World / Europe / North America region tabs (bounding-box filtered)
- Plane markers rotated to true heading, color-coded: black = cruising,
  lime = climbing, orange = descending
- Click any aircraft → live telemetry (altitude, ground speed, heading, ICAO24, position)
- Search by callsign, min-altitude filter, live stats (count, avg altitude,
  fastest, origin countries)
- Auto-refresh every 10s; 8s server-side cache to protect the rate limit

## Higher rate limits (optional)

Anonymous OpenSky access is rate-limited. For an OAuth2 client (free account at
opensky-network.org), set before launching:

```powershell
$env:OPENSKY_CLIENT_ID = "your_id"
$env:OPENSKY_CLIENT_SECRET = "your_secret"
```

The server auto-fetches and refreshes the bearer token when these are present.
