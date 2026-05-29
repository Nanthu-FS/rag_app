"""Extract GPS coordinates and camera metadata from image EXIF data."""
import struct
from dataclasses import dataclass
from typing import Optional
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS


@dataclass
class ExifResult:
    lat: Optional[float] = None
    lon: Optional[float] = None
    altitude: Optional[float] = None
    timestamp: Optional[str] = None
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    source: str = "none"


def _dms_to_decimal(dms, ref: str) -> float:
    """Convert degrees/minutes/seconds tuple to decimal degrees."""
    try:
        d = float(dms[0])
        m = float(dms[1])
        s = float(dms[2])
        dec = d + m / 60.0 + s / 3600.0
        if ref in ("S", "W"):
            dec = -dec
        return round(dec, 7)
    except Exception:
        return 0.0


def read_exif(image_path: str) -> ExifResult:
    result = ExifResult()
    try:
        img = Image.open(image_path)
        result.width, result.height = img.size

        exif_data = img._getexif()
        if not exif_data:
            return result

        decoded = {}
        gps_info = {}
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag] = gps_value
            else:
                decoded[tag] = value

        result.camera_make = str(decoded.get("Make", "")).strip() or None
        result.camera_model = str(decoded.get("Model", "")).strip() or None

        dt = decoded.get("DateTimeOriginal") or decoded.get("DateTime")
        result.timestamp = str(dt).strip() if dt else None

        if gps_info.get("GPSLatitude") and gps_info.get("GPSLongitude"):
            result.lat = _dms_to_decimal(
                gps_info["GPSLatitude"],
                gps_info.get("GPSLatitudeRef", "N")
            )
            result.lon = _dms_to_decimal(
                gps_info["GPSLongitude"],
                gps_info.get("GPSLongitudeRef", "E")
            )
            if result.lat != 0.0 or result.lon != 0.0:
                result.source = "exif_gps"
                alt = gps_info.get("GPSAltitude")
                if alt:
                    try:
                        result.altitude = round(float(alt), 1)
                    except Exception:
                        pass
    except Exception:
        pass

    return result
