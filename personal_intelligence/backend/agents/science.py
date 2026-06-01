"""Science agent — physics, chemistry, biology, astronomy, medicine.

Pure-knowledge specialist: answers conceptual questions from the brain's own
training. For anything time-sensitive (latest research, current data) the router
is expected to also pick ``web_search``; this agent stays focused on explaining.
"""

from __future__ import annotations

from agents import AgentResult
from ollama_client import chat

_SYSTEM = """You are Personal Intelligence's science module — a rigorous, clear science expert
covering physics, chemistry, biology, astronomy, and medicine.

- Give an accurate, well-structured explanation pitched to an intelligent layperson.
- Use correct terminology and include the key formula or mechanism when relevant.
- Be concise: a tight paragraph or a short list, not an essay.
- If something is genuinely uncertain or contested, say so. Never fabricate figures.
- You are NOT for medical advice on a personal condition — explain the science and
  recommend consulting a professional for personal medical decisions."""


async def run(query: str) -> AgentResult:
    answer = await chat(_SYSTEM, query, temperature=0.3)
    return AgentResult(
        name="science",
        answer=answer or "(no answer produced)",
        ok=bool(answer),
    )
