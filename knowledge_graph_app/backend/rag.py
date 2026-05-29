"""Chunk-level vector store for general (non-graph) questions about the corpus."""
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings

from . import config

_embeddings = None
_store = None


def _emb() -> OllamaEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = OllamaEmbeddings(model=config.EMBED_MODEL)
    return _embeddings


def store() -> Chroma:
    global _store
    if _store is None:
        _store = Chroma(
            collection_name="kg_chunks",
            embedding_function=_emb(),
            persist_directory=config.CHROMA_DIR,
        )
    return _store


def add_chunks(texts: list[str], source: str):
    if not texts:
        return
    metadatas = [{"source": source} for _ in texts]
    store().add_texts(texts=texts, metadatas=metadatas)


def retrieve(query: str, k: int = 4):
    try:
        results = store().similarity_search_with_relevance_scores(query, k=k)
    except Exception:
        return []
    return [{"text": d.page_content, "source": d.metadata.get("source", "doc"),
             "score": round(max(0.0, float(s)), 3)} for d, s in results]


def reset():
    global _store
    try:
        store()._collection.delete(where={})
    except Exception:
        pass
    _store = None
