"""Personal Intelligence specialist agents.

Each agent is a single async ``run(query) -> AgentResult`` coroutine with one
narrow job — the discipline that keeps everything reliable on local models.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AgentResult:
    """Uniform return shape every specialist produces."""

    name: str
    answer: str
    sources: list[dict] = field(default_factory=list)  # [{"title","url"}]
    ok: bool = True
