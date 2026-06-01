"""The supervisor — reads a request and decides which specialists handle it.

This is the cheapest agent (runs on the small ``llama3.2:3b`` so it can stay
co-resident with the 14B brain and answer instantly). Its only job is strict
classification, returned as JSON and validated here — never free-form reasoning,
which small local models do poorly.

Output contract:  {"agents": ["web_search", "calculator", ...], "reason": "..."}
"""

from __future__ import annotations

from ollama_client import ROUTER_MODEL, chat_json

# The roster the router is allowed to choose from. "general" = no specialist
# needed; the synthesizer answers directly from the brain's own knowledge.
VALID_AGENTS = {"web_search", "calculator", "science", "tech", "general"}

ROUTER_SYSTEM = """You are the dispatcher for Personal Intelligence, a multi-agent assistant.
Read the user's message and decide which specialist agents should handle it.

Available agents:
- web_search : current events, news, prices, real-time facts, anything needing the live web
- calculator : arithmetic, unit conversion, percentages, algebra, any actual math
- science    : physics, chemistry, biology, astronomy, medicine — conceptual explanations
- tech       : software, hardware, engineering, "how does X work", programming concepts
- general    : greetings, chit-chat, opinions, or general knowledge needing no specialist

Rules:
- Pick the FEWEST agents that fully cover the request (usually 1, at most 3).
- Use calculator for ANY real computation — never let another agent do the math.
- Combine agents when genuinely needed (e.g. "latest iPhone price in euros" -> web_search + calculator).
- If unsure or it's casual conversation, use ["general"].

Return ONLY JSON, no prose:
{"agents": ["..."], "reason": "one short phrase"}"""

# A few examples steer the 3B model far more than prose alone.
_FEWSHOT = """Examples:
"what's 18% tip on 64.50?" -> {"agents": ["calculator"], "reason": "tip math"}
"who won the f1 race yesterday?" -> {"agents": ["web_search"], "reason": "current event"}
"why is the sky blue?" -> {"agents": ["science"], "reason": "physics concept"}
"explain how a transformer model works" -> {"agents": ["tech"], "reason": "ML concept"}
"hey personal_intelligence, you there?" -> {"agents": ["general"], "reason": "chit-chat"}
"current bitcoin price in INR" -> {"agents": ["web_search", "calculator"], "reason": "live price + convert"}
"""


async def route(query: str) -> dict:
    """Classify a request into a list of specialist agents.

    Always returns a dict with a non-empty, validated ``agents`` list, falling
    back to ["general"] if the model returns nothing usable.
    """
    user = f'{_FEWSHOT}\nNow classify:\n"{query.strip()}" ->'
    data = await chat_json(ROUTER_SYSTEM, user, model=ROUTER_MODEL, temperature=0.0)

    raw = data.get("agents") if isinstance(data, dict) else None
    agents = [a for a in raw if a in VALID_AGENTS] if isinstance(raw, list) else []

    if not agents:
        agents = ["general"]
    # "general" is only meaningful alone — if a real specialist was chosen, drop it.
    if len(agents) > 1 and "general" in agents:
        agents = [a for a in agents if a != "general"]

    return {"agents": agents, "reason": data.get("reason", "") if isinstance(data, dict) else ""}
