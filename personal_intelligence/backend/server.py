"""Personal Intelligence FastAPI backend.

Endpoints:
  GET  /api/health        -> Ollama + model presence report
  POST /api/ask           -> SSE stream of orchestration events (plan/agent/token/done)
  POST /api/stt           -> {text} transcribed from an uploaded audio blob

Also serves the static frontend so the whole assistant runs from one process.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import ollama_client
from orchestrator import handle

# Windows consoles default to cp1252; keep logging from crashing on unicode.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Personal Intelligence", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    query: str


@app.get("/api/health")
async def health() -> dict:
    return await ollama_client.health()


@app.post("/api/ask")
async def ask(req: AskRequest):
    """Stream orchestration events as Server-Sent Events."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    async def event_stream():
        try:
            async for event in handle(query):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:  # surface failures as a final event, don't hang the UI
            yield f'data: {json.dumps({"type": "error", "message": str(e)})}\n\n'

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/stt")
async def stt(audio: UploadFile = File(...)) -> dict:
    """Transcribe an uploaded audio clip to text (local faster-whisper)."""
    from voice import stt as stt_mod  # lazy: avoids loading Whisper unless used

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")

    suffix = Path(audio.filename or "clip.webm").suffix or ".webm"
    try:
        text = stt_mod.transcribe_bytes(data, suffix=suffix)
    except Exception as e:
        # Log the full traceback so a real-device decode/inference failure is
        # diagnosable in the server console, not just a bare 500 in the browser.
        import traceback

        print(f"[stt] transcription failed ({len(data)} bytes, {suffix}):", flush=True)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")
    return {"text": text}


# Static frontend at root (html=True serves index.html at "/"). API routes above
# take precedence over this catch-all mount.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8850)
