"""LLM-based entity/relationship extraction. Turns free text into typed triples."""
import json
import re

from langchain_ollama import OllamaLLM

from . import config

_llm = None


def _model() -> OllamaLLM:
    global _llm
    if _llm is None:
        _llm = OllamaLLM(model=config.EXTRACT_MODEL, temperature=0)
    return _llm


EXTRACT_PROMPT = """You are a precise information-extraction engine that builds a knowledge graph.
From the TEXT, extract factual relationships as a JSON array of triples. Each item:
{{"source": "<entity>", "source_type": "<type>", "relation": "<short verb phrase, 1-4 words>", "target": "<entity>", "target_type": "<type>"}}

Rules:
- type is one of: Person, Organization, Place, Concept, Product, Event, Other
- Only extract relationships that are explicitly stated in the text.
- Use clean, canonical entity names (no pronouns like "he"/"it"; resolve to the named entity).
- Keep relations short and lowercase (e.g. "founded", "works at", "located in", "acquired", "part of").
- Return ONLY the JSON array. No commentary.

EXAMPLE
TEXT: "Ada Lovelace, an English mathematician, worked with Charles Babbage on the Analytical Engine in London."
JSON: [
  {{"source":"Ada Lovelace","source_type":"Person","relation":"worked with","target":"Charles Babbage","target_type":"Person"}},
  {{"source":"Ada Lovelace","source_type":"Person","relation":"contributed to","target":"Analytical Engine","target_type":"Concept"}},
  {{"source":"Charles Babbage","source_type":"Person","relation":"designed","target":"Analytical Engine","target_type":"Concept"}},
  {{"source":"Analytical Engine","source_type":"Concept","relation":"located in","target":"London","target_type":"Place"}}
]

TEXT: "{text}"
JSON:"""


def _extract_json_array(raw: str) -> list:
    # 1) a proper [ ... ] array
    m = re.search(r"\[.*\]", raw, re.S)
    if m:
        blob = m.group(0)
        try:
            return json.loads(blob)
        except Exception:
            cleaned = re.sub(r",\s*([\]}])", r"\1", blob)
            try:
                return json.loads(cleaned)
            except Exception:
                pass
    # 2) fallback: models often drop the surrounding brackets and emit bare,
    #    comma-separated {objects}. Parse each flat object individually.
    items = []
    for obj in re.findall(r"\{[^{}]*\}", raw, re.S):
        try:
            items.append(json.loads(obj))
        except Exception:
            try:
                items.append(json.loads(re.sub(r",\s*}", "}", obj)))
            except Exception:
                continue
    return items


def extract_triples(text: str) -> list[dict]:
    raw = _model().invoke(EXTRACT_PROMPT.format(text=text.replace('"', "'")))
    items = _extract_json_array(raw)
    triples = []
    for it in items:
        if not isinstance(it, dict):
            continue
        src = str(it.get("source", "")).strip()
        tgt = str(it.get("target", "")).strip()
        rel = str(it.get("relation", "")).strip()
        if not src or not tgt or not rel:
            continue
        triples.append({
            "source": src, "target": tgt, "relation": rel,
            "source_type": it.get("source_type", "Other"),
            "target_type": it.get("target_type", "Other"),
        })
        if len(triples) >= config.MAX_TRIPLES_PER_CHUNK:
            break
    return triples
