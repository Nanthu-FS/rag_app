"""The orchestrator — router -> parallel specialists -> streaming synthesizer.

This is the supervisor-router pattern implemented directly in async Python (rather
than through a LangGraph StateGraph) so the final answer can stream cleanly — the
LangGraph streaming-context issue noted in the project's notes is sidestepped
entirely. It yields a sequence of event dicts the server turns into SSE.

Event stream:
  {"type": "plan",  "agents": [...], "reason": "..."}
  {"type": "agent", "name": "...", "ok": bool, "summary": "...", "sources": [...]}
  {"type": "token", "text": "..."}        # repeated, the streaming Personal Intelligence reply
  {"type": "done",  "sources": [...]}     # de-duplicated citations
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from agents import AgentResult, calculator, science, tech, web_search
from router import route
from synthesizer import synthesize

# Map the router's agent names to their run() coroutines. "general" has no
# specialist — it falls straight through to the synthesizer's direct mode.
_AGENTS = {
    "web_search": web_search.run,
    "calculator": calculator.run,
    "science": science.run,
    "tech": tech.run,
}


async def _run_agent(name: str, query: str) -> AgentResult:
    try:
        return await _AGENTS[name](query)
    except Exception as e:  # never let one specialist crash the whole turn
        return AgentResult(name=name, answer=f"(module error: {e})", ok=False)


async def handle(query: str) -> AsyncIterator[dict]:
    query = query.strip()
    if not query:
        yield {"type": "token", "text": "I didn't catch that, sir."}
        yield {"type": "done", "sources": []}
        return

    # 1) Router decides the team.
    plan = await route(query)
    agents = plan["agents"]
    yield {"type": "plan", "agents": agents, "reason": plan.get("reason", "")}

    # 2) Fan out to the chosen specialists in parallel (skip the no-op "general").
    specialists = [a for a in agents if a in _AGENTS]
    results: list[AgentResult] = []
    if specialists:
        results = await asyncio.gather(*[_run_agent(a, query) for a in specialists])
        for r in results:
            yield {
                "type": "agent",
                "name": r.name,
                "ok": r.ok,
                "summary": r.answer[:280],
                "sources": r.sources,
            }

    # 3) Synthesizer streams the final Personal Intelligence-voiced answer.
    async for tok in synthesize(query, results):
        yield {"type": "token", "text": tok}

    # 4) De-duplicate citations for the UI.
    seen: set[str] = set()
    sources: list[dict] = []
    for r in results:
        for s in r.sources:
            if s["url"] and s["url"] not in seen:
                seen.add(s["url"])
                sources.append(s)
    yield {"type": "done", "sources": sources}
