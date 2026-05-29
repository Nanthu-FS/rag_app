"""FastAPI server — image upload → EXIF + vision analysis → NDJSON stream."""
import asyncio
import json
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config, history
from .exif_reader import read_exif
from .vision_analyzer import analyze_image
from .geocoder import reverse_geocode

app = FastAPI(title="GeoSnap")


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _confidence_color(source: str, pct: int) -> str:
    if source == "exif_gps":
        return "#7c3aed"   # purple — GPS exact
    if pct >= 70:
        return "#2563eb"   # blue — high vision
    if pct >= 40:
        return "#d97706"   # amber — medium
    return "#dc2626"       # red — low


@app.get("/api/health")
async def health():
    import requests as _r
    try:
        models = _r.get("http://localhost:11434/api/tags", timeout=3).json()
        names = [m["name"] for m in models.get("models", [])]
        vision_ready = any("vision" in n for n in names)
    except Exception:
        names = []
        vision_ready = False

    records = history.get_all()
    stats = {
        "total": len(records),
        "gps": sum(1 for r in records if r.get("source") == "exif_gps"),
        "vision": sum(1 for r in records if r.get("source") == "vision"),
        "countries": len({r.get("country") for r in records if r.get("country")}),
    }
    return {
        "ok": True,
        "vision_model": config.VISION_MODEL,
        "vision_ready": vision_ready,
        "available_models": names,
        "stats": stats,
    }


@app.get("/api/history")
async def get_history():
    return history.get_all()


@app.post("/api/clear")
async def clear_history():
    history.clear()
    return {"ok": True}


async def _analyze_stream(image_path: str, filename: str):
    yield _line({"type": "status", "msg": "Reading EXIF metadata…"})

    exif = await asyncio.to_thread(read_exif, image_path)
    yield _line({
        "type": "exif",
        "has_gps": exif.source == "exif_gps",
        "lat": exif.lat,
        "lon": exif.lon,
        "altitude": exif.altitude,
        "timestamp": exif.timestamp,
        "camera": f"{exif.camera_make or ''} {exif.camera_model or ''}".strip() or None,
        "width": exif.width,
        "height": exif.height,
    })

    lat, lon, source = exif.lat, exif.lon, exif.source
    country, city, landmark = None, None, None
    confidence, confidence_pct = "low", 0
    clues, reasoning = [], ""
    place = {}

    if exif.source == "exif_gps":
        yield _line({"type": "status", "msg": "GPS found — reverse-geocoding…"})
        place = await asyncio.to_thread(reverse_geocode, lat, lon)
        country = place.get("country")
        city = place.get("city") or place.get("state")
        confidence = "high"
        confidence_pct = 100
        clues = ["GPS coordinates embedded in EXIF metadata"]
        reasoning = f"Exact GPS coordinates extracted from photo EXIF: {lat:.5f}, {lon:.5f}"
    else:
        yield _line({"type": "status", "msg": f"No GPS — asking {config.VISION_MODEL}…"})
        vision = await asyncio.to_thread(analyze_image, image_path)

        if vision.error:
            yield _line({"type": "error", "msg": vision.error})
            yield _line({"type": "done"})
            return

        lat, lon = vision.lat, vision.lon
        country = vision.country
        city = vision.city
        landmark = vision.landmark
        confidence = vision.confidence
        confidence_pct = vision.confidence_pct
        clues = vision.clues
        reasoning = vision.raw_reasoning

        if lat and lon:
            yield _line({"type": "status", "msg": "Vision result — reverse-geocoding…"})
            place = await asyncio.to_thread(reverse_geocode, lat, lon)
            if place.get("country") and not country:
                country = place["country"]
            if place.get("city") and not city:
                city = place["city"]

    color = _confidence_color(source, confidence_pct)
    record = {
        "filename": filename,
        "source": source,
        "lat": lat,
        "lon": lon,
        "country": country or place.get("country"),
        "city": city or place.get("city"),
        "landmark": landmark,
        "confidence": confidence,
        "confidence_pct": confidence_pct,
        "clues": clues,
        "reasoning": reasoning,
        "place": place,
        "color": color,
    }
    record = history.add_record(record)

    yield _line({"type": "result", **record})
    yield _line({"type": "done"})


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    ext = Path(file.filename or "img.jpg").suffix.lower() or ".jpg"
    fname = f"{uuid.uuid4().hex[:8]}{ext}"
    save_path = os.path.join(config.UPLOADS_DIR, fname)

    raw = await file.read()
    with open(save_path, "wb") as f:
        f.write(raw)

    return StreamingResponse(
        _analyze_stream(save_path, file.filename or fname),
        media_type="application/x-ndjson",
    )


app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
