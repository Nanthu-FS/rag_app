# P.I. — Local Multi-Agent Assistant

A voice-capable, fully-local multi-agent assistant in the spirit of Iron Man's
Personal Intelligence. A lightweight **router** reads your request and dispatches it to the right
**specialist agents** (web search, calculator, science, tech), which run in
parallel; a **synthesizer** fuses their findings into one streaming, Personal Intelligence-voiced
reply. Everything runs on your own machine via Ollama + faster-whisper.

```
You ──► Router (llama3.2:3b) ──► [ Web · Calc · Science · Tech ]  (parallel)
                                          │
                                          ▼
                              Synthesizer (qwen2.5:14b) ──► streamed reply ──► voice
```

## Architecture

| Component | Model / tool | Job |
|---|---|---|
| **Router** | `llama3.2:3b` | Classify the request into specialist(s). Strict JSON, validated. |
| **Web Search** | DuckDuckGo + `qwen2.5:14b` | Search, fetch pages, summarize with citations. |
| **Calculator** | brain + **sympy** | LLM translates words → expression; **sympy computes** (never the LLM). |
| **Science** | `qwen2.5:14b` | Physics/chem/bio/astronomy/medicine explanations. |
| **Tech** | `qwen2.5:14b` | Software/hardware/engineering concepts. |
| **Synthesizer** | `qwen2.5:14b` | Fuse findings in the Personal Intelligence persona, streamed token-by-token. |
| **Voice in** | faster-whisper `small` (GPU) | Push-to-talk speech-to-text. |
| **Voice out** | Browser Web Speech (en-GB) | Spoken replies, zero server plumbing. |

The supervisor-router pattern keeps every agent's job narrow — the discipline that
makes local 7–14B models reliable. Math is never trusted to the LLM; it's routed
to sympy and evaluated exactly.

### Why these models on a 4070 Ti Super (16 GB)
- `llama3.2:3b` router (~2 GB) stays co-resident with the `qwen2.5:14b` brain
  (~9 GB) → no model-swap latency between routing and answering. ~11 GB resident.
- faster-whisper `small` on GPU (~1 GB) leaves comfortable headroom.
- **Max-quality swap:** set `PI_MODEL=mistral-small3.2:24b` (already installed)
  to trade some voice responsiveness for a stronger brain.

## Prerequisites
- [Ollama](https://ollama.com) running, with the models pulled:
  ```
  ollama pull llama3.2:3b
  ollama pull qwen2.5:14b-instruct
  ```
- Python 3.10 (the interpreter with this project's stack).
- A CUDA-capable GPU for fast Whisper (falls back to CPU automatically).

## Run
```
run.bat
```
Then open <http://127.0.0.1:8850>. Type a question, or **hold the 🎙️ button** to
speak (push-to-talk). Toggle spoken replies with the 🔊 button.

> First run installs Python deps and downloads the Whisper `small` weights (~0.5 GB).

### Voice on GPU (Windows note)
faster-whisper needs its own CUDA 12 runtime libs (separate from Ollama's). They're
in `requirements.txt` (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`, `nvidia-cuda-runtime-cu12`)
and the STT loader puts them on `PATH` at startup. If they're missing or CUDA fails,
STT **automatically falls back to CPU** (a short clip still transcribes in ~1–2 s) —
it never errors out. Force CPU with `PI_WHISPER_DEVICE=cpu`.

## Configuration (env vars)
| Var | Default | Purpose |
|---|---|---|
| `PI_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `PI_ROUTER_MODEL` | `llama3.2:3b` | Router model |
| `PI_MODEL` | `qwen2.5:14b-instruct` | Specialist + synthesizer brain |
| `PI_SYNTH_MODEL` | = `PI_MODEL` | Override synth model only |
| `PI_WHISPER_MODEL` | `small` | Whisper size (tiny…large-v3) |
| `PI_WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` |

## API
- `GET /api/health` — Ollama reachability + whether configured models are present.
- `POST /api/ask` `{query}` — Server-Sent Events: `plan` → `agent`(s) → `token`(s) → `done`.
- `POST /api/stt` (multipart `audio`) — `{text}` transcribed locally.

## Roadmap (next phases)
- **Phase 2:** Coder agent (sandboxed exec) + Memory/Recall agent (SQLite + embeddings).
- **Phase 3:** richer arc-reactor UI, per-agent "thinking" trace.
- **Phase 4:** wake-word ("Personal Intelligence") always-listening mode; Piper server-side TTS.
- **Phase 5:** proactive/system agents (time, weather, open apps).
