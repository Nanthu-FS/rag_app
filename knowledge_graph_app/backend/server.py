"""FastAPI server: streaming ingestion (live graph growth) + graph-aware Q&A."""
import asyncio
import json
import os
import tempfile

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_text_splitters import RecursiveCharacterTextSplitter

from . import config, extractor, rag
from .graph_flow import QUERY_GRAPH, answer_llm
from .graphstore import STORE

app = FastAPI(title="Knowledge Graph Builder")


def _line(obj: dict) -> str:
    return json.dumps(obj) + "\n"


def _load_text_from_upload(upload: UploadFile, raw: bytes) -> str:
    suffix = os.path.splitext(upload.filename or "")[1].lower()
    if suffix == ".pdf":
        from langchain_community.document_loaders import PyPDFLoader
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(raw)
            path = tmp.name
        try:
            docs = PyPDFLoader(path).load()
            return "\n\n".join(d.page_content for d in docs)
        finally:
            os.unlink(path)
    return raw.decode("utf-8", errors="ignore")


@app.get("/api/health")
async def health():
    return {"ok": True, "models": {"extract": config.EXTRACT_MODEL, "answer": config.ANSWER_MODEL},
            "stats": STORE.stats()}


@app.get("/api/graph")
async def graph():
    return STORE.to_vis()


@app.post("/api/reset")
async def reset():
    STORE.clear()
    rag.reset()
    return {"ok": True, "stats": STORE.stats()}


# ── ingestion (streamed) ──────────────────────────────────────────────────────
async def _ingest_stream(text: str, source: str):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=config.CHUNK_SIZE, chunk_overlap=config.CHUNK_OVERLAP)
    chunks = splitter.split_text(text)
    total = len(chunks)
    yield _line({"type": "start", "chunks": total, "source": source})

    for i, chunk in enumerate(chunks):
        # extraction is blocking → run in a thread so we don't stall the loop
        triples = await asyncio.to_thread(extractor.extract_triples, chunk)
        added = STORE.ingest_triples(triples)
        STORE.chunks_seen += 1
        await asyncio.to_thread(rag.add_chunks, [chunk], source)
        yield _line({
            "type": "delta",
            "i": i + 1, "total": total,
            "edges": [{"source": a["source"], "target": a["target"], "relation": a["relation"],
                       "source_node": a["source_node"], "target_node": a["target_node"]}
                      for a in added],
        })

    STORE.save()
    vis = STORE.to_vis()
    yield _line({"type": "done", "graph": vis, "stats": vis["stats"]})


@app.post("/api/ingest")
async def ingest(request: Request,
                 text: str = Form(default=""),
                 file: UploadFile = File(default=None)):
    source = "pasted text"
    body_text = text or ""
    if file is not None:
        raw = await file.read()
        body_text = _load_text_from_upload(file, raw)
        source = file.filename or "upload"
    body_text = (body_text or "").strip()
    if not body_text:
        return StreamingResponse(iter([_line({"type": "done", "graph": STORE.to_vis(),
                                              "stats": STORE.stats()})]),
                                 media_type="application/x-ndjson")
    return StreamingResponse(_ingest_stream(body_text, source),
                             media_type="application/x-ndjson")


# ── query (streamed) ──────────────────────────────────────────────────────────
async def _chat_stream(question: str):
    state = await QUERY_GRAPH.ainvoke({"question": question})
    yield _line({
        "type": "focus",
        "intent": state.get("intent"),
        "note": state.get("note", ""),
        "focus_nodes": state.get("focus_nodes", []),
        "focus_edges": state.get("focus_edges", []),
        "matched": state.get("matched", []),
    })
    prompt = state.get("prompt")
    if prompt:
        async for tok in answer_llm().astream(prompt):
            if tok:
                yield _line({"type": "token", "t": tok})
    yield _line({"type": "done"})


@app.post("/api/chat")
async def chat(req: Request):
    body = await req.json()
    question = (body.get("question") or "").strip()
    if not question:
        return StreamingResponse(iter([_line({"type": "done"})]),
                                 media_type="application/x-ndjson")
    return StreamingResponse(_chat_stream(question), media_type="application/x-ndjson")


app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
