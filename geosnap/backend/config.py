import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
DATA_DIR = os.path.join(PROJECT_DIR, "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")

VISION_MODEL = os.getenv("GEOSNAP_MODEL", "llama3.2-vision:11b")
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
HOST = os.getenv("GEOSNAP_HOST", "127.0.0.1")
PORT = int(os.getenv("GEOSNAP_PORT", "8820"))

os.makedirs(UPLOADS_DIR, exist_ok=True)
