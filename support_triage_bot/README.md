# Nimbus Triage Bot

A **local, multi-agent customer-support triage bot** built with **Ollama + LangChain
+ LangGraph**, fronted by a **FastAPI** server and a custom glassmorphism UI with a
**live routing visualization**.

Every message is:

1. **Classified** by an LLM into `billing` / `technical` / `general` (with a confidence score)
2. **Retrieved** against that domain's *own* isolated vector store
3. **Gated** by escalation logic (explicit human request, frustration, low confidence, no KB coverage)
4. **Answered** by a domain specialist persona — or **handed off to a human** with a ticket

The browser watches the whole graph run in real time: the routing pipeline, the
detected category, confidence + KB-coverage meters, and the answer streaming token
by token.

```
START → classify → retrieve → gate ──► generate ──► END
                                  └───► handoff  ──► END
```

## Architecture

| Layer | Tech | File |
|------|------|------|
| Orchestration | LangGraph state machine | [backend/graph.py](backend/graph.py) |
| Per-domain RAG | Chroma + Ollama embeddings | [backend/rag.py](backend/rag.py) |
| API + streaming | FastAPI (NDJSON stream) | [backend/server.py](backend/server.py) |
| UI | Vanilla HTML/CSS/JS, glassmorphism | [frontend/](frontend/) |
| Knowledge base | Markdown per domain | [knowledge/](knowledge/) |

All models run **locally via Ollama** — nothing leaves the machine.

## Prerequisites

- [Ollama](https://ollama.com) running, with the models pulled:
  ```
  ollama pull llama3.2:3b
  ollama pull nomic-embed-text
  ```
- Python 3.10+ with the dependencies installed:
  ```
  pip install -r requirements.txt
  ```

## Run it

```bash
# 1. Build the three domain knowledge bases (one-time, re-run when KB changes)
python ingest.py          # or: ingest.bat on Windows

# 2. Start the server
python run.py             # or: run.bat on Windows
```

Open **http://127.0.0.1:8800**.

> On this machine the bundled `.bat` files point at the Python 3.10 install that
> already has the LangChain stack.

## Try these

| Message | Routes to |
|---|---|
| *"I was charged twice this month, can I get a refund?"* | 💳 Billing |
| *"I can't log in, it says my account is locked."* | 🛠️ Technical |
| *"What are your support hours and where are you based?"* | 💬 General |
| *"This is the third time it's broken and I want a human now."* | 🚨 Human escalation |

## Configuration

Everything is env-overridable (see [backend/config.py](backend/config.py)):

| Variable | Default | Meaning |
|---|---|---|
| `TRIAGE_CLASSIFIER_MODEL` | `llama3.2:3b` | model that routes intent |
| `TRIAGE_ANSWER_MODEL` | `llama3.2:3b` | model that writes answers (try `mistral-small3.2:24b`) |
| `TRIAGE_EMBED_MODEL` | `nomic-embed-text:latest` | embedding model |
| `TRIAGE_MIN_CONFIDENCE` | `0.45` | below → escalate |
| `TRIAGE_MIN_RETRIEVAL` | `0.15` | below → escalate |
| `TRIAGE_PORT` | `8800` | server port |

## Extending it

- **Add a domain:** drop a folder under `knowledge/`, add it to `CATEGORIES` in
  `config.py`, update the classifier prompt + persona in `graph.py`, re-run `ingest.py`.
- **Add knowledge:** drop more `.md`/`.txt` files into a domain folder, re-run `ingest.py`.
- **Real ticketing:** replace the stub in `handoff_node` with a call to your
  helpdesk API (Zendesk, Intercom, Linear, …).
