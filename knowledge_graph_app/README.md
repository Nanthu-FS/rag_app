# Atlas — Knowledge Graph Builder

A **local, graph-RAG** app that reads any text, **extracts entities and the
relationships between them**, and builds a live, interactive knowledge graph.
Then you can ask **"how is X connected to Y?"** — it finds the actual path through
the graph, lights it up, and explains it. Everything runs locally via Ollama.

Unlike plain RAG (which answers "what does the doc say about X?"), this models the
*structure* — so it can answer relational questions across the whole corpus.

## What it does

1. **Build** — paste text or upload a file. Each chunk is sent to an LLM that
   extracts typed triples `(entity) -[relation]-> (entity)`. Entities are
   normalized and merged; the graph grows **live** on screen as it ingests.
2. **Explore** — drag nodes, zoom/pan, hover to see relationships, click a node to
   focus its neighbourhood. Nodes are coloured by type (Person, Organization,
   Place, Concept, Product, Event).
3. **Ask** — ask how two things connect. A LangGraph brain detects the intent,
   finds the shortest path between the entities (or a single entity's
   neighbourhood, or falls back to semantic search), **animates the path on the
   graph**, and streams a prose explanation.

```
ingest:  text -> chunk -> LLM extract triples -> normalize/merge -> graph + vectors
query:   START -> detect (which entities? what intent?) -> gather (path / neighbourhood / semantic) -> END
                                                                    |
                                              server streams the answer + a "focus" event the canvas animates
```

## Architecture

| Layer | Tech | File |
|---|---|---|
| Entity/relation extraction | Ollama LLM + robust JSON parsing | `backend/extractor.py` |
| Graph store | dependency-free: merge, BFS shortest-path, neighbourhood, JSON persistence | `backend/graphstore.py` |
| Query brain | **LangGraph** (detect -> gather) | `backend/graph_flow.py` |
| Semantic fallback | Chroma + Ollama embeddings | `backend/rag.py` |
| API + streaming | FastAPI, NDJSON (live graph growth + answer tokens) | `backend/server.py` |
| UI | vanilla HTML/CSS/JS, **custom force-directed canvas** (no graph libs) | `frontend/` |

The graph visualization is hand-rolled on `<canvas>` — its own physics simulation
(repulsion + springs + centering), drag/zoom/pan, hover highlighting, animated
node growth, path-pulse animation, and animated view-fit. No external graph
library, so it stays fully local and dependency-free.

## Prerequisites

- [Ollama](https://ollama.com) running, models pulled:
  ```
  ollama pull llama3.2:3b
  ollama pull nomic-embed-text
  ```
- Python 3.10+ with deps:
  ```
  pip install -r requirements.txt
  ```

## Run

```bash
python run.py            # or run.bat on Windows  ->  http://127.0.0.1:8810
```

Click **Try the sample story**, or paste your own text in **Build graph** mode,
then switch to **Ask** and try *"How is Dana Cole connected to Vizly?"*

## Configuration (env-overridable, see `backend/config.py`)

| Variable | Default | Meaning |
|---|---|---|
| `KG_EXTRACT_MODEL` | `llama3.2:3b` | model that extracts triples (try `mistral-small3.2:24b` for richer graphs) |
| `KG_ANSWER_MODEL` | `llama3.2:3b` | model that writes answers |
| `KG_EMBED_MODEL` | `nomic-embed-text:latest` | embeddings for semantic fallback |
| `KG_PORT` | `8810` | server port |

## Notes

- The graph persists to `data/graph.json` and reloads on boot.
- For best extraction quality on dense text, a larger model (`mistral-small3.2:24b`)
  produces noticeably richer, cleaner graphs at the cost of speed.
