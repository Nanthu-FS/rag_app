"""The synthesizer — fuses specialist outputs into one streaming Personal Intelligence reply.

This is the only place the Personal Intelligence persona lives. The specialists stay neutral and
accurate; the synthesizer wraps their findings in the dry, courteous, faintly
witty voice and streams it out token-by-token (for the UI and TTS).

It runs on the 14B brain — the one component where model quality most affects the
felt experience, so it gets the biggest model that still keeps voice responsive.
"""

from __future__ import annotations

from typing import AsyncIterator

from agents import AgentResult
from ollama_client import chat_stream

PI_PERSONA = """You are Personal Intelligence (you may refer to yourself as "PI"),
an advanced AI assistant — articulate, calm, and quietly witty, in the manner of a
highly capable British butler-engineer.

Voice:
- Address the user as "sir" occasionally (not every sentence).
- If asked your name, you are Personal Intelligence (PI).
- Be concise, precise, and composed. Dry humour is welcome; never goofy.
- Sound confident but never arrogant; deferential without being servile.

Critically:
- You are given findings from your specialist modules. Synthesize them into ONE
  coherent answer. Do not mention the modules by name or expose the machinery.
- Preserve any inline citations [1], [2] from the research findings.
- Never contradict the calculator's result — it is computed exactly, trust it.
- If the findings are thin or failed, say so honestly and briefly.
- Keep it tight: answer first, elaboration only if it adds real value."""

_DIRECT_PERSONA = PI_PERSONA + """

There were no specialist findings for this one — answer directly from your own
knowledge in the Personal Intelligence voice. If you are not certain, say so."""


def _format_findings(query: str, results: list[AgentResult]) -> str:
    parts = [f'User asked: "{query}"', "", "Specialist findings:"]
    for r in results:
        label = r.name.replace("_", " ").title()
        status = "" if r.ok else " (note: this module reported a problem)"
        parts.append(f"\n[{label}]{status}\n{r.answer}")
    parts.append("\nNow respond as Personal Intelligence, synthesizing the above into one answer.")
    return "\n".join(parts)


async def synthesize(query: str, results: list[AgentResult]) -> AsyncIterator[str]:
    """Stream the final Personal Intelligence answer.

    If there are no usable specialist results (e.g. the 'general' route), Personal Intelligence
    answers directly from the brain's own knowledge.
    """
    usable = [r for r in results if r.answer and r.ok]

    if not usable:
        async for tok in chat_stream(_DIRECT_PERSONA, query, temperature=0.5):
            yield tok
        return

    user = _format_findings(query, results)
    async for tok in chat_stream(PI_PERSONA, user, temperature=0.4):
        yield tok
