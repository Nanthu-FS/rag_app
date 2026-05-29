"""FastAPI server: serves the frontend and streams the triage graph as NDJSON."""
import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .graph import (ROUTING_GRAPH, answer_llm, build_answer_prompt,
                    build_handoff_message, chunk_text)

app = FastAPI(title="Nimbus Triage Bot")


def _line(obj: dict) -> str:
    return json.dumps(obj) + "\n"


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "models": {
            "classifier": config.CLASSIFIER_MODEL,
            "answer": config.ANSWER_MODEL,
            "embeddings": config.EMBED_MODEL,
        },
        "categories": config.CATEGORIES,
    }


async def _event_stream(query: str, history: list):
    """Run the LangGraph routing brain, then stream the answer as NDJSON.

    1. `ROUTING_GRAPH.astream(..., stream_mode="updates")` emits a line per node
       (classify / retrieve / gate) the moment it completes — that drives the
       live routing panel.
    2. Based on the gate decision we either stream the specialist's answer token
       by token (`OllamaLLM.astream`) or 'type out' the human-handoff message.
    """
    state = {"query": query, "history": history}
    routed: dict = dict(state)  # seed with query/history; node deltas accumulate on top

    async for chunk in ROUTING_GRAPH.astream(state, stream_mode="updates"):
        for node, delta in chunk.items():
            routed.update(delta)
            if node == "classify":
                yield _line({
                    "type": "classify",
                    "category": delta.get("category"),
                    "confidence": delta.get("confidence"),
                    "reason": delta.get("reason"),
                })
            elif node == "retrieve":
                yield _line({
                    "type": "retrieval",
                    "retrieval_score": delta.get("retrieval_score"),
                    "sources": delta.get("docs", []),
                })
            elif node == "gate":
                yield _line({
                    "type": "gate",
                    "escalate": delta.get("escalate"),
                    "reason": delta.get("escalate_reason"),
                })

    # ── answer phase ──────────────────────────────────────────────────────
    if routed.get("escalate"):
        message, ticket = build_handoff_message(routed)
        yield _line({"type": "routed", "agent": "human", "ticket": ticket})
        for tok in chunk_text(message):
            yield _line({"type": "token", "t": tok})
    else:
        yield _line({"type": "routed", "agent": "specialist"})
        prompt = build_answer_prompt(routed)
        async for tok in answer_llm().astream(prompt):
            if tok:
                yield _line({"type": "token", "t": tok})

    yield _line({"type": "done"})


@app.post("/api/chat")
async def chat(req: Request):
    body = await req.json()
    query = (body.get("query") or "").strip()
    history = body.get("history") or []
    if not query:
        return StreamingResponse(iter([_line({"type": "done"})]),
                                 media_type="application/x-ndjson")
    return StreamingResponse(_event_stream(query, history),
                             media_type="application/x-ndjson")


# Frontend (mounted last so /api/* takes precedence).
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
