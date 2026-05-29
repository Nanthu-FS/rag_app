"""Per-domain RAG stores.

Each support domain (billing / technical / general) gets its own isolated
Chroma collection so retrieval never leaks context across teams.
"""
import glob
import os

from langchain_chroma import Chroma
from langchain_community.document_loaders import TextLoader
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from . import config

_embeddings = None
_stores: dict[str, Chroma] = {}


def get_embeddings() -> OllamaEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = OllamaEmbeddings(model=config.EMBED_MODEL)
    return _embeddings


def store_path(category: str) -> str:
    return os.path.join(config.VECTOR_DIR, category)


def build_store(category: str) -> Chroma:
    """Ingest knowledge/<category>/*.md|*.txt into a fresh Chroma collection."""
    folder = os.path.join(config.KNOWLEDGE_DIR, category)
    files = sorted(glob.glob(os.path.join(folder, "*.md")) +
                   glob.glob(os.path.join(folder, "*.txt")))

    docs = []
    for fp in files:
        loaded = TextLoader(fp, encoding="utf-8").load()
        for d in loaded:
            d.metadata["source"] = os.path.basename(fp)
            d.metadata["category"] = category
        docs.extend(loaded)

    splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)
    chunks = splitter.split_documents(docs)

    return Chroma.from_documents(
        documents=chunks,
        embedding=get_embeddings(),
        persist_directory=store_path(category),
        collection_name=f"kb_{category}",
        collection_metadata={"hnsw:space": "cosine"},
    )


def get_store(category: str) -> Chroma:
    if category not in _stores:
        _stores[category] = Chroma(
            persist_directory=store_path(category),
            embedding_function=get_embeddings(),
            collection_name=f"kb_{category}",
        )
    return _stores[category]


def retrieve(category: str, query: str, k: int = config.TOP_K):
    """Return (sources, best_relevance) for a query against one domain store.

    Relevance scores are cosine-based in [0, 1] — higher is a closer match.
    """
    store = get_store(category)
    try:
        results = store.similarity_search_with_relevance_scores(query, k=k)
    except Exception:
        results = []

    sources = []
    for doc, score in results:
        sources.append({
            "source": doc.metadata.get("source", "knowledge-base"),
            "snippet": doc.page_content.strip(),
            "score": round(max(0.0, float(score)), 3),
        })
    best = max((s["score"] for s in sources), default=0.0)
    return sources, best
