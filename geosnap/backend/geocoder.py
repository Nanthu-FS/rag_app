"""Reverse geocoding via Nominatim (OpenStreetMap, no API key needed)."""
import requests
from . import config


def reverse_geocode(lat: float, lon: float) -> dict:
    """Returns place info dict: display_name, country, city, state."""
    try:
        resp = requests.get(
            config.NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1},
            headers={"User-Agent": "GeoSnap/1.0 (local app)"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            addr = data.get("address", {})
            return {
                "display_name": data.get("display_name", ""),
                "country": addr.get("country", ""),
                "country_code": addr.get("country_code", "").upper(),
                "state": addr.get("state", ""),
                "city": (addr.get("city") or addr.get("town")
                         or addr.get("village") or addr.get("municipality") or ""),
                "postcode": addr.get("postcode", ""),
            }
    except Exception:
        pass
    return {}
