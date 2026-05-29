# GeoSnap — Image Location Intelligence

A **fully local** app that pinpoints where a photo was taken — using EXIF GPS metadata when present, or a local **vision LLM** (`llama3.2-vision:11b`) to reason from visual clues (architecture, signage, vegetation, landmarks) when there is no GPS. Results drop coloured pins on a **live 3D WebGL globe**.

Everything runs on your machine — no cloud APIs, no data sent anywhere.

## How it works

```
Upload photo
  ├─ EXIF GPS present → exact lat/lon + Nominatim reverse-geocode → purple pin
  └─ No GPS → llama3.2-vision:11b geo-detective analysis
               (architecture, signs, foliage, road markings, landmarks…)
               → estimated lat/lon + confidence → Nominatim → coloured pin
```

## Features

- **EXIF reader** — extracts GPS, altitude, timestamp, camera make/model from any JPEG/PNG
- **Vision LLM** — `llama3.2-vision:11b` prompted as a geo-detective; returns structured JSON with country, city, lat/lon, confidence %, and the visual clues it used
- **Reverse geocoding** — Nominatim (OpenStreetMap, no API key required)
- **3D globe** — globe.gl WebGL, Blue Marble texture, auto-rotate, drag/zoom/pan, animated pins
- **Result card** — place name, coordinates, source, visual clue list, model reasoning, EXIF metadata grid
- **Persistent history** — all analyses saved to `data/history.json`; pins restored on reload
- **Drag-and-drop** upload from anywhere on the screen

### Pin colour legend

| Colour | Meaning |
|---|---|
| Purple | GPS exact — from EXIF metadata |
| Blue | AI high confidence (≥ 70%) |
| Amber | AI medium confidence (40–70%) |
| Red | AI low confidence (< 40%) |

## Prerequisites

```bash
# Pull the vision model (~7.8 GB — one time)
ollama pull llama3.2-vision:11b

# Install Python deps
pip install -r requirements.txt
```

## Run

```bash
python run.py        # → http://127.0.0.1:8820
# or on Windows
run.bat
```

## Architecture

| Layer | Tech | File |
|---|---|---|
| EXIF extraction | Pillow + piexif | `backend/exif_reader.py` |
| Vision analysis | Ollama `llama3.2-vision:11b` | `backend/vision_analyzer.py` |
| Reverse geocoding | Nominatim / OpenStreetMap | `backend/geocoder.py` |
| History | JSON persistence + threading | `backend/history.py` |
| API | FastAPI + NDJSON streaming | `backend/server.py` |
| UI | Vanilla HTML/CSS/JS + globe.gl | `frontend/` |

## Notes

- `globe.gl.min.js` is vendored locally so the globe works with no internet.
- `data/` (uploads + history) is git-ignored — only source is committed.
- Set `GEOSNAP_MODEL` env var to switch vision models (e.g. `llava:13b`).
