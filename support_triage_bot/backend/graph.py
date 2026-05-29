"""LangGraph triage state machine.

    START → classify → retrieve → gate ──► generate ──► END
                                      └───► handoff  ──► END

* classify  — LLM routes the message into billing / technical / general (+ confidence)
* retrieve  — pulls context from that domain's own vector store
* gate      — escalation logic: explicit human ask, frustration, low confidence, no coverage
* generate  — the domain specialist answers, grounded in retrieved context (streamed)
* handoff   — escalation path: opens a ticket and hands to a human (streamed)

Tokens are emitted from inside the nodes via LangGraph's custom stream writer,
so the server can relay them to the browser live.
"""
import json
import re
import uuid
from typing import List, TypedDict

from langchain_ollama import OllamaLLM
from langgraph.graph import END, START, StateGraph

from . import config, rag


# ── State ─────────────────────────────────────────────────────────────────────
class TriageState(TypedDict, total=False):
    query: str
    history: List[dict]
    category: str
    confidence: float
    reason: str
    docs: List[dict]
    retrieval_score: float
    answer: str
    escalate: bool
    escalate_reason: str
    ticket: str
    trace: List[dict]


# ── Lazy LLM singletons ───────────────────────────────────────────────────────
_classifier = None
_answerer = None


def _classifier_llm() -> OllamaLLM:
    global _classifier
    if _classifier is None:
        _classifier = OllamaLLM(model=config.CLASSIFIER_MODEL, temperature=0)
    return _classifier


def _answer_llm() -> OllamaLLM:
    global _answerer
    if _answerer is None:
        _answerer = OllamaLLM(model=config.ANSWER_MODEL, temperature=0.2)
    return _answerer


def _fmt_history(history, limit: int = 6) -> str:
    rows = []
    for turn in (history or [])[-limit:]:
        role = "Customer" if turn.get("role") == "user" else "Agent"
        rows.append(f"{role}: {turn.get('content', '')}")
    return "\n".join(rows)


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


def _chunk_text(text: str):
    for tok in re.findall(r"\S+\s*|\n", text):
        yield tok


# ── Prompts & personas ────────────────────────────────────────────────────────
CLASSIFY_PROMPT = """You are the triage router for a SaaS customer support center.
Classify the customer's latest message into EXACTLY one category:

- billing: payments, invoices, refunds, pricing, plans, subscriptions, charges, discounts
- technical: errors, bugs, login problems, setup, integrations, API, performance, product how-to
- general: company info, policies, hours, contact details, account/profile questions, anything else

Reply with ONLY a JSON object, no prose:
{{"category": "billing|technical|general", "confidence": <0.0-1.0>, "reason": "<=12 words"}}

Conversation so far:
{history}

Latest customer message: {query}
JSON:"""

PERSONAS = {
    "billing": "You are Ava, a warm and precise billing specialist for Nimbus.",
    "technical": "You are Max, a senior technical support engineer for Nimbus.",
    "general": "You are Sam, a friendly Nimbus customer support agent.",
}

ANSWER_PROMPT = """{persona}

Answer the customer using the knowledge-base context below. Be concise, warm, and
specific. Prefer short paragraphs or bullet points. If the context does not fully
cover the question, answer what you can and offer a clear next step. Never invent
prices, policies, or numbers that are not in the context.

Knowledge-base context:
{context}

Conversation:
{history}

Customer: {query}
Your reply:"""

HUMAN_RE = re.compile(
    r"\b(human|real person|live (agent|support|person)|speak (to|with) (a|someone)|"
    r"talk to (a|someone)|agent please|representative)\b", re.I)
FRUSTRATION_RE = re.compile(
    r"\b(angry|furious|frustrat\w*|terrible|awful|useless|ridiculous|unacceptable|"
    r"worst|disgust\w*|sue|lawyer|legal action|cancel (my )?(account|subscription|plan))\b", re.I)


# ── Nodes ─────────────────────────────────────────────────────────────────────
def classify_node(state: TriageState) -> dict:
    raw = _classifier_llm().invoke(CLASSIFY_PROMPT.format(
        history=_fmt_history(state.get("history")) or "(none)",
        query=state["query"],
    ))
    data = _extract_json(raw)

    category = data.get("category", "general")
    if category not in config.CATEGORIES:
        category = "general"
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        confidence = 0.5
    reason = str(data.get("reason", "")).strip()[:160]

    trace = [{
        "node": "classify",
        "label": f"Routed to {category} desk",
        "detail": reason or f"Best match: {category}",
        "status": "done",
    }]
    return {"category": category, "confidence": confidence, "reason": reason, "trace": trace}


def retrieve_node(state: TriageState) -> dict:
    docs, best = rag.retrieve(state["category"], state["query"])
    trace = state.get("trace", []) + [{
        "node": "retrieve",
        "label": f"Searched {state['category']} knowledge base",
        "detail": f"{len(docs)} passage(s) · top match {int(best * 100)}%",
        "status": "done",
    }]
    return {"docs": docs, "retrieval_score": best, "trace": trace}


def gate_node(state: TriageState) -> dict:
    query = state["query"]
    confidence = state.get("confidence", 0.5)
    retrieval = state.get("retrieval_score", 0.0)

    escalate, reason = False, ""
    if HUMAN_RE.search(query):
        escalate, reason = True, "Customer explicitly asked for a human agent."
    elif FRUSTRATION_RE.search(query):
        escalate, reason = True, "Strong negative sentiment / churn risk detected."
    elif confidence < config.MIN_CONFIDENCE:
        escalate, reason = True, f"Low routing confidence ({int(confidence * 100)}%) — request is ambiguous."
    elif retrieval < config.MIN_RETRIEVAL:
        escalate, reason = True, "No relevant knowledge-base coverage for this question."

    step = {
        "node": "gate",
        "label": "Escalation triggered" if escalate else "Auto-resolve approved",
        "detail": reason if escalate else "Confidence and coverage are sufficient.",
        "status": "warn" if escalate else "done",
    }
    return {"escalate": escalate, "escalate_reason": reason,
            "trace": state.get("trace", []) + [step]}


# ── Answer / handoff builders (shared by the graph and the streaming server) ──
def build_answer_prompt(state: TriageState) -> str:
    context = "\n\n---\n\n".join(d["snippet"] for d in state.get("docs", []))
    context = context or "(no specific context found)"
    return ANSWER_PROMPT.format(
        persona=PERSONAS.get(state.get("category", "general"), PERSONAS["general"]),
        context=context,
        history=_fmt_history(state.get("history")) or "(none)",
        query=state["query"],
    )


def build_handoff_message(state: TriageState):
    ticket = "TKT-" + uuid.uuid4().hex[:6].upper()
    category = state.get("category", "general")
    message = (
        f"I want to make sure this is handled properly, so I'm connecting you with a "
        f"human specialist on our **{category}** team.\n\n"
        f"I've opened priority ticket **{ticket}** summarising your request — a specialist "
        f"will follow up shortly. In the meantime, is there anything you'd like me to add "
        f"to the ticket notes?"
    )
    return message, ticket


def chunk_text(text: str):
    """Yield word-ish chunks so the handoff message can be 'typed' like a stream."""
    return _chunk_text(text)


def answer_llm() -> OllamaLLM:
    return _answer_llm()


# ── Nodes for the full end-to-end graph (used by .invoke / CLI / tests) ───────
def generate_node(state: TriageState) -> dict:
    answer = _answer_llm().invoke(build_answer_prompt(state))
    trace = state.get("trace", []) + [{
        "node": "generate",
        "label": f"{state['category'].title()} specialist replied",
        "detail": "Answer grounded in retrieved context.",
        "status": "done",
    }]
    return {"answer": answer, "trace": trace}


def handoff_node(state: TriageState) -> dict:
    message, ticket = build_handoff_message(state)
    trace = state.get("trace", []) + [{
        "node": "handoff",
        "label": "Routed to a human specialist",
        "detail": f"Priority ticket {ticket} created.",
        "status": "warn",
    }]
    return {"answer": message, "ticket": ticket, "trace": trace}


def _route(state: TriageState) -> str:
    return "handoff" if state.get("escalate") else "generate"


# ── Graph assembly ────────────────────────────────────────────────────────────
def build_routing_graph():
    """Routing brain: classify → retrieve → gate. The server streams the answer
    itself (token-level streaming through the graph is unreliable on this build)."""
    g = StateGraph(TriageState)
    g.add_node("classify", classify_node)
    g.add_node("retrieve", retrieve_node)
    g.add_node("gate", gate_node)
    g.add_edge(START, "classify")
    g.add_edge("classify", "retrieve")
    g.add_edge("retrieve", "gate")
    g.add_edge("gate", END)
    return g.compile()


def build_graph():
    """Full end-to-end graph including answer generation — used by .invoke / CLI."""
    g = StateGraph(TriageState)
    g.add_node("classify", classify_node)
    g.add_node("retrieve", retrieve_node)
    g.add_node("gate", gate_node)
    g.add_node("generate", generate_node)
    g.add_node("handoff", handoff_node)
    g.add_edge(START, "classify")
    g.add_edge("classify", "retrieve")
    g.add_edge("retrieve", "gate")
    g.add_conditional_edges("gate", _route, {"generate": "generate", "handoff": "handoff"})
    g.add_edge("generate", END)
    g.add_edge("handoff", END)
    return g.compile()


ROUTING_GRAPH = build_routing_graph()
GRAPH = build_graph()
