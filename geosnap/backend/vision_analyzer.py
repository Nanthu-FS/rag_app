"""Send image to local Ollama vision model and extract structured geo-intelligence."""
import base64
import json
import re
import requests
from typing import Optional
from dataclasses import dataclass, field
from . import config


@dataclass
class VisionResult:
    country: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    landmark: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    confidence: str = "low"        # low / medium / high
    confidence_pct: int = 0
    clues: list = field(default_factory=list)
    raw_reasoning: str = ""
    error: Optional[str] = None
    source: str = "vision"


GEO_PROMPT = """You are a world-class geo-location analyst. Study this image carefully and identify where in the world it was taken.

Examine and describe every visual clue:
- Architecture style (buildings, roofs, facades, materials)
- Language/script on signs, storefronts, license plates
- Vegetation (palm trees, pine, tropical, alpine, etc.)
- Road markings, traffic signs, driving side
- Fashion, skin tones, cultural indicators
- Sky, lighting, terrain, climate hints
- Any recognisable landmarks, monuments, flags

Then produce a JSON object (and ONLY the JSON, no other text):
{
  "country": "country name or null",
  "city": "city or region name or null",
  "region": "broader region e.g. South Asia, Western Europe or null",
  "landmark": "specific landmark name if visible or null",
  "lat": estimated_latitude_as_number_or_null,
  "lon": estimated_longitude_as_number_or_null,
  "confidence": "low|medium|high",
  "confidence_pct": 0-100,
  "clues": ["clue 1", "clue 2", "clue 3"],
  "reasoning": "brief 2-3 sentence explanation of your deduction"
}

If the image gives no geographic information (screenshot, abstract art, etc.) return confidence_pct 0 and nulls."""


def _image_to_b64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _extract_json(text: str) -> dict:
    # try direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # look for {...} block
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            # fix trailing commas
            cleaned = re.sub(r",\s*([\]}])", r"\1", m.group(0))
            try:
                return json.loads(cleaned)
            except Exception:
                pass
    return {}


def analyze_image(image_path: str) -> VisionResult:
    result = VisionResult()
    try:
        b64 = _image_to_b64(image_path)
        payload = {
            "model": config.VISION_MODEL,
            "prompt": GEO_PROMPT,
            "images": [b64],
            "stream": False,
            "options": {"temperature": 0.1},
        }
        resp = requests.post(
            "http://localhost:11434/api/generate",
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        result.raw_reasoning = raw[:2000]

        data = _extract_json(raw)
        if not data:
            result.error = "Could not parse model response"
            return result

        result.country = data.get("country")
        result.city = data.get("city")
        result.region = data.get("region")
        result.landmark = data.get("landmark")
        result.confidence = str(data.get("confidence", "low")).lower()
        result.clues = data.get("clues", [])
        result.raw_reasoning = data.get("reasoning", raw[:500])

        pct = data.get("confidence_pct", 0)
        try:
            result.confidence_pct = int(pct)
        except Exception:
            result.confidence_pct = 0

        lat = data.get("lat")
        lon = data.get("lon")
        if lat is not None and lon is not None:
            try:
                result.lat = float(lat)
                result.lon = float(lon)
            except Exception:
                pass

    except requests.exceptions.ConnectionError:
        result.error = "Ollama not running — start it with: ollama serve"
    except Exception as e:
        result.error = str(e)

    return result
