import sys
import uvicorn
from backend import config

try: sys.stdout.reconfigure(encoding="utf-8")
except: pass

if __name__ == "__main__":
    print(f"GeoSnap -> http://{config.HOST}:{config.PORT}")
    uvicorn.run("backend.server:app", host=config.HOST, port=config.PORT, reload=False)
