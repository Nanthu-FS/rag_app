"""Async Ollama client — the shared brain interface for every Personal Intelligence agent.

Two call styles:
  * ``chat_json``   — one-shot, ``format=json``, returns a parsed dict. Used by the
    router and the calculator (translation step) where we need structured output.
  * ``chat``        — one-shot plain text. Used by the specialist agents.
  * ``chat_stream`` — async token generator. Used by the synthesizer so the final
    Personal Intelligence reply streams to the UI (and to TTS) as it is produced.

Models are env-configurable so the whole stack can be re-pointed (e.g. swap the
14B brain for ``mistral-small3.2:24b``) without touching code:

  PI_OLLAMA_URL     default http://localhost:11434
  PI_ROUTER_MODEL   default llama3.2:3b           (fast JSON classifier)
  PI_MODEL          default qwen2.5:14b-instruct  (specialists + synth brain)
  PI_SYNTH_MODEL    default = PI_MODEL         (kept same to avoid VRAM swap)
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator

import httpx

OLLAMA_URL = os.environ.get("PI_OLLAMA_URL", "http://localhost:11434")
ROUTER_MODEL = os.environ.get("PI_ROUTER_MODEL", "llama3.2:3b")
BRAIN_MODEL = os.environ.get("PI_MODEL", "qwen2.5:14b-instruct")
SYNTH_MODEL = os.environ.get("PI_SYNTH_MODEL", BRAIN_MODEL)

# Generous because the 14B brain on a single GPU can take a few seconds for the
# first token on a cold load; specialists run in parallel so wall-time stays sane.
_TIMEOUT = httpx.Timeout(180.0, connect=10.0)


def _messages(system: str | None, user: str) -> list[dict]:
    msgs: list[dict] = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": user})
    return msgs


def _extract_json(text: str) -> dict:
    """Best-effort JSON salvage — strips code fences and grabs the outer braces."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text
        text = text.lstrip("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


async def chat_json(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float = 0.0,
) -> dict:
    """One-shot call constrained to JSON. Returns {} on any failure."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model or BRAIN_MODEL,
                "stream": False,
                "format": "json",
                "options": {"temperature": temperature},
                "messages": _messages(system, user),
            },
        )
        resp.raise_for_status()
        content = resp.json().get("message", {}).get("content", "")
    try:
        return _extract_json(content)
    except (json.JSONDecodeError, ValueError):
        return {}


async def chat(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float = 0.3,
) -> str:
    """One-shot plain-text call. Returns '' on failure."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model or BRAIN_MODEL,
                "stream": False,
                "options": {"temperature": temperature},
                "messages": _messages(system, user),
            },
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "").strip()


async def chat_stream(
    system: str,
    user: str,
    *,
    model: str | None = None,
    temperature: float = 0.4,
) -> AsyncIterator[str]:
    """Stream a reply token-by-token. Yields content deltas as they arrive."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model or SYNTH_MODEL,
                "stream": True,
                "options": {"temperature": temperature},
                "messages": _messages(system, user),
            },
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                delta = chunk.get("message", {}).get("content", "")
                if delta:
                    yield delta
                if chunk.get("done"):
                    break


async def health() -> dict:
    """Report which configured models are actually present in Ollama."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            installed = {m["name"] for m in resp.json().get("models", [])}
    except httpx.HTTPError:
        return {"ollama": "unreachable", "url": OLLAMA_URL}

    def present(name: str) -> bool:
        # Ollama tags carry a ':latest'/':tag' suffix; match on the base too.
        return name in installed or any(i.split(":")[0] == name.split(":")[0] for i in installed)

    return {
        "ollama": "ok",
        "url": OLLAMA_URL,
        "router_model": ROUTER_MODEL,
        "brain_model": BRAIN_MODEL,
        "synth_model": SYNTH_MODEL,
        "models_present": {
            ROUTER_MODEL: present(ROUTER_MODEL),
            BRAIN_MODEL: present(BRAIN_MODEL),
            SYNTH_MODEL: present(SYNTH_MODEL),
        },
    }
