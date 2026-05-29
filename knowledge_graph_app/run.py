"""Launch the knowledge-graph server."""
import sys

import uvicorn

from backend import config

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

if __name__ == "__main__":
    print(f"Knowledge Graph Builder -> http://{config.HOST}:{config.PORT}")
    uvicorn.run("backend.server:app", host=config.HOST, port=config.PORT, reload=False)
