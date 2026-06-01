"""Tech agent — software, hardware, engineering, "how does X work".

Pure-knowledge specialist for technical and engineering concepts. Pairs with
``web_search`` (chosen by the router) when current product/version facts are needed.
"""

from __future__ import annotations

from agents import AgentResult
from ollama_client import chat

_SYSTEM = """You are Personal Intelligence's technology module — a sharp engineer covering
software, hardware, networking, and systems.

- Explain clearly and correctly, with the right level of technical depth.
- Prefer concrete detail (how it actually works) over hand-waving analogies.
- Use a short code snippet or step list when it makes the answer clearer.
- Be concise and precise. Flag trade-offs honestly rather than overselling.
- If a question depends on the latest versions/specs you may not have, say so."""


async def run(query: str) -> AgentResult:
    answer = await chat(_SYSTEM, query, temperature=0.3)
    return AgentResult(
        name="tech",
        answer=answer or "(no answer produced)",
        ok=bool(answer),
    )
