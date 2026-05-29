"""Launch the triage bot server."""
import sys

import uvicorn

from backend import config

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

if __name__ == "__main__":
    print(f"Nimbus Triage Bot -> http://{config.HOST}:{config.PORT}")
    uvicorn.run("backend.server:app", host=config.HOST, port=config.PORT, reload=False)
