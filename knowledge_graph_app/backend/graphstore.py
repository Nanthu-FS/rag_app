"""In-memory knowledge graph with merge, neighbourhood, shortest-path and JSON
persistence. Deliberately dependency-free (no networkx) so it stays portable."""
import json
import os
import re
import threading
from collections import deque

from . import config

_lock = threading.Lock()


def normalize(name: str) -> str:
    """Canonical id for an entity: lowercase, de-articled, punctuation-stripped."""
    n = (name or "").strip().lower()
    n = re.sub(r"^(the|a|an)\s+", "", n)
    n = re.sub(r"[\"'`.,;:!?()]+", "", n)
    n = re.sub(r"\s+", " ", n)
    return n.strip()


class GraphStore:
    def __init__(self):
        # id -> {id, name, type, count}
        self.nodes: dict[str, dict] = {}
        # (src,rel,tgt) -> {source, target, relation, count}
        self.edges: dict[tuple, dict] = {}
        # undirected adjacency: id -> set of neighbour ids
        self.adj: dict[str, set] = {}
        self.chunks_seen = 0

    # ── mutation ──────────────────────────────────────────────────────────
    def add_entity(self, name: str, etype: str = "Other") -> str | None:
        nid = normalize(name)
        if not nid or len(nid) > 60:
            return None
        if etype not in config.ENTITY_TYPES:
            etype = "Other"
        node = self.nodes.get(nid)
        if node is None:
            self.nodes[nid] = {"id": nid, "name": name.strip(), "type": etype, "count": 1}
            self.adj.setdefault(nid, set())
        else:
            node["count"] += 1
            # upgrade a generic type to a specific one if we learn it later
            if node["type"] == "Other" and etype != "Other":
                node["type"] = etype
        return nid

    def add_relation(self, src: str, relation: str, tgt: str,
                     src_type: str = "Other", tgt_type: str = "Other") -> dict | None:
        s = self.add_entity(src, src_type)
        t = self.add_entity(tgt, tgt_type)
        rel = re.sub(r"\s+", " ", (relation or "related to").strip().lower())[:40] or "related to"
        if not s or not t or s == t:
            return None
        key = (s, rel, t)
        e = self.edges.get(key)
        if e is None:
            e = {"source": s, "target": t, "relation": rel, "count": 1}
            self.edges[key] = e
            self.adj[s].add(t)
            self.adj[t].add(s)
        else:
            e["count"] += 1
        return e

    def ingest_triples(self, triples: list[dict]) -> list[dict]:
        """Add a batch of extracted triples; return the edges actually created/updated."""
        added = []
        with _lock:
            for tr in triples:
                e = self.add_relation(
                    tr.get("source", ""), tr.get("relation", ""), tr.get("target", ""),
                    tr.get("source_type", "Other"), tr.get("target_type", "Other"),
                )
                if e:
                    added.append({
                        "source": e["source"], "target": e["target"], "relation": e["relation"],
                        "source_node": self.nodes[e["source"]],
                        "target_node": self.nodes[e["target"]],
                    })
        return added

    # ── queries ───────────────────────────────────────────────────────────
    def find_matches(self, text: str) -> list[str]:
        """Return ids of known entities mentioned in text, longest name first.

        Punctuation is flattened to spaces on both sides so "Vizly?" still matches
        the entity "Vizly".
        """
        low = " " + re.sub(r"[^a-z0-9]+", " ", text.lower()).strip() + " "
        hits = []
        for nid, node in self.nodes.items():
            needle = re.sub(r"[^a-z0-9]+", " ", node["name"].lower()).strip()
            if len(needle) < 2:
                continue
            if f" {needle} " in low or f" {nid} " in low:
                hits.append((nid, len(needle)))
        hits.sort(key=lambda x: -x[1])
        # de-dup overlapping shorter names contained in a longer accepted one
        chosen, taken_names = [], []
        for nid, _ in hits:
            nm = re.sub(r"[^a-z0-9]+", " ", self.nodes[nid]["name"].lower()).strip()
            if any(nm in t and nm != t for t in taken_names):
                continue
            chosen.append(nid)
            taken_names.append(nm)
        return chosen

    def shortest_path(self, a: str, b: str):
        """BFS shortest undirected path. Returns (node_ids, edges) or ([], [])."""
        if a not in self.adj or b not in self.adj:
            return [], []
        if a == b:
            return [a], []
        prev = {a: None}
        q = deque([a])
        while q:
            cur = q.popleft()
            if cur == b:
                break
            for nb in self.adj[cur]:
                if nb not in prev:
                    prev[nb] = cur
                    q.append(nb)
        if b not in prev:
            return [], []
        # reconstruct
        path = []
        cur = b
        while cur is not None:
            path.append(cur)
            cur = prev[cur]
        path.reverse()
        edges = []
        for i in range(len(path) - 1):
            edges.append(self._edge_between(path[i], path[i + 1]))
        return path, edges

    def _edge_between(self, x: str, y: str) -> dict:
        for (s, rel, t), e in self.edges.items():
            if (s == x and t == y) or (s == y and t == x):
                return {"source": s, "target": t, "relation": rel}
        return {"source": x, "target": y, "relation": "related to"}

    def neighbourhood(self, nid: str, depth: int = 1):
        """Return (node_ids, edges) within `depth` hops of nid."""
        if nid not in self.adj:
            return [], []
        seen = {nid}
        frontier = {nid}
        for _ in range(depth):
            nxt = set()
            for n in frontier:
                nxt |= self.adj[n]
            seen |= nxt
            frontier = nxt
        edges = []
        for (s, rel, t), e in self.edges.items():
            if s in seen and t in seen:
                edges.append({"source": s, "target": t, "relation": rel})
        return list(seen), edges

    # ── serialization ─────────────────────────────────────────────────────
    def to_vis(self) -> dict:
        return {
            "nodes": [dict(n) for n in self.nodes.values()],
            "edges": [{"source": e["source"], "target": e["target"],
                       "relation": e["relation"], "count": e["count"]}
                      for e in self.edges.values()],
            "stats": self.stats(),
        }

    def stats(self) -> dict:
        types = {}
        for n in self.nodes.values():
            types[n["type"]] = types.get(n["type"], 0) + 1
        return {"entities": len(self.nodes), "relations": len(self.edges),
                "chunks": self.chunks_seen, "by_type": types}

    def save(self):
        with _lock:
            data = {
                "nodes": list(self.nodes.values()),
                "edges": [{"source": e["source"], "relation": e["relation"],
                           "target": e["target"], "count": e["count"]}
                          for e in self.edges.values()],
                "chunks_seen": self.chunks_seen,
            }
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with open(config.GRAPH_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def load(self):
        if not os.path.exists(config.GRAPH_JSON):
            return
        try:
            with open(config.GRAPH_JSON, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return
        self.nodes, self.edges, self.adj = {}, {}, {}
        for n in data.get("nodes", []):
            self.nodes[n["id"]] = n
            self.adj.setdefault(n["id"], set())
        for e in data.get("edges", []):
            key = (e["source"], e["relation"], e["target"])
            self.edges[key] = e
            self.adj.setdefault(e["source"], set()).add(e["target"])
            self.adj.setdefault(e["target"], set()).add(e["source"])
        self.chunks_seen = data.get("chunks_seen", 0)

    def clear(self):
        with _lock:
            self.nodes, self.edges, self.adj = {}, {}, {}
            self.chunks_seen = 0
        if os.path.exists(config.GRAPH_JSON):
            os.remove(config.GRAPH_JSON)


STORE = GraphStore()
STORE.load()
