"""LangGraph query brain.

    START → detect → gather → END

* detect  — find which known entities the question mentions; pick an intent
            (connection between two entities / single-entity / general semantic)
* gather  — pull the relevant slice of the graph (a path, a neighbourhood) or
            fall back to vector retrieval, and build the answer prompt + the set
            of nodes/edges the UI should light up.

The server runs this graph, emits a "focus" event so the canvas can animate,
then streams the answer from the answer LLM.
"""
import re
from typing import List, TypedDict

from langchain_ollama import OllamaLLM
from langgraph.graph import END, START, StateGraph

from . import config, rag
from .graphstore import STORE

_answer = None


def answer_llm() -> OllamaLLM:
    global _answer
    if _answer is None:
        _answer = OllamaLLM(model=config.ANSWER_MODEL, temperature=0.2)
    return _answer


class QState(TypedDict, total=False):
    question: str
    intent: str
    matched: List[str]
    focus_nodes: List[str]
    focus_edges: List[dict]
    context: str
    prompt: str
    note: str


CONNECT_RE = re.compile(
    r"\b(connect\w*|relat\w*|link\w*|between|path|how (is|are|does)|tie\w*|associat\w*)\b", re.I)


def _name(nid: str) -> str:
    n = STORE.nodes.get(nid)
    return n["name"] if n else nid


def detect_node(state: QState) -> dict:
    q = state["question"]
    matched = STORE.find_matches(q)
    asks_connection = bool(CONNECT_RE.search(q))

    if len(matched) >= 2 and asks_connection:
        intent = "connection"
    elif len(matched) >= 2:
        intent = "connection"  # two known entities named together → show the link
    elif len(matched) == 1:
        intent = "entity"
    else:
        intent = "general"
    return {"intent": intent, "matched": matched}


CONNECTION_PROMPT = """You are a knowledge-graph analyst. Using ONLY the relationship chain below,
explain in clear, natural prose how {a} is connected to {b}. Walk through the path
one step at a time. If the chain is empty, say that no connection was found in the graph.

Relationship chain:
{context}

Question: {question}
Answer:"""

ENTITY_PROMPT = """You are a knowledge-graph analyst. Summarize what the graph knows about {entity},
using ONLY the relationships below. Be concise and group related facts.

Relationships:
{context}

Question: {question}
Answer:"""

GENERAL_PROMPT = """You are a helpful analyst. Answer the question using ONLY the document context below.
If the context is insufficient, say so plainly.

Context:
{context}

Question: {question}
Answer:"""


def gather_node(state: QState) -> dict:
    q = state["question"]
    intent = state["intent"]
    matched = state.get("matched", [])

    if intent == "connection":
        a, b = matched[0], matched[1]
        path, edges = STORE.shortest_path(a, b)
        if path:
            lines = [f"{_name(e['source'])} --[{e['relation']}]--> {_name(e['target'])}" for e in edges]
            context = "\n".join(lines)
            prompt = CONNECTION_PROMPT.format(a=_name(a), b=_name(b), context=context, question=q)
            return {"focus_nodes": path, "focus_edges": edges, "context": context, "prompt": prompt,
                    "note": f"Path found · {len(edges)} hop(s)"}
        # no path — show both neighbourhoods, explain separately
        na, ea = STORE.neighbourhood(a, 1)
        nb, eb = STORE.neighbourhood(b, 1)
        ctx = (f"No direct path between {_name(a)} and {_name(b)}.\n"
               f"{_name(a)} is connected to: " + ", ".join(_name(x) for x in na if x != a) + "\n"
               f"{_name(b)} is connected to: " + ", ".join(_name(x) for x in nb if x != b))
        prompt = CONNECTION_PROMPT.format(a=_name(a), b=_name(b), context=ctx, question=q)
        return {"focus_nodes": list(set(na + nb)), "focus_edges": ea + eb, "context": ctx, "prompt": prompt,
                "note": "No direct path"}

    if intent == "entity":
        e = matched[0]
        nodes, edges = STORE.neighbourhood(e, 1)
        lines = [f"{_name(x['source'])} --[{x['relation']}]--> {_name(x['target'])}" for x in edges]
        context = "\n".join(lines) or f"No relationships recorded for {_name(e)}."
        prompt = ENTITY_PROMPT.format(entity=_name(e), context=context, question=q)
        return {"focus_nodes": nodes, "focus_edges": edges, "context": context, "prompt": prompt,
                "note": f"{len(edges)} connection(s)"}

    # general
    docs = rag.retrieve(q, k=4)
    context = "\n\n---\n\n".join(d["text"] for d in docs) or "(no documents ingested yet)"
    prompt = GENERAL_PROMPT.format(context=context, question=q)
    # try to light up any entities mentioned in retrieved text
    focus = STORE.find_matches(" ".join(d["text"] for d in docs))[:8]
    return {"focus_nodes": focus, "focus_edges": [], "context": context, "prompt": prompt,
            "note": "Semantic search"}


def build_query_graph():
    g = StateGraph(QState)
    g.add_node("detect", detect_node)
    g.add_node("gather", gather_node)
    g.add_edge(START, "detect")
    g.add_edge("detect", "gather")
    g.add_edge("gather", END)
    return g.compile()


QUERY_GRAPH = build_query_graph()
