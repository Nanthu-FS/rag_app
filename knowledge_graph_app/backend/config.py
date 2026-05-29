"""Configuration for the knowledge-graph app (env-overridable)."""
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "data")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
GRAPH_JSON = os.path.join(DATA_DIR, "graph.json")
CHROMA_DIR = os.path.join(DATA_DIR, "chroma")

EXTRACT_MODEL = os.getenv("KG_EXTRACT_MODEL", "llama3.2:3b")
ANSWER_MODEL = os.getenv("KG_ANSWER_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("KG_EMBED_MODEL", "nomic-embed-text:latest")

CHUNK_SIZE = int(os.getenv("KG_CHUNK_SIZE", "650"))
CHUNK_OVERLAP = int(os.getenv("KG_CHUNK_OVERLAP", "90"))
MAX_TRIPLES_PER_CHUNK = int(os.getenv("KG_MAX_TRIPLES", "12"))

ENTITY_TYPES = ["Person", "Organization", "Place", "Concept", "Product", "Event", "Other"]

HOST = os.getenv("KG_HOST", "127.0.0.1")
PORT = int(os.getenv("KG_PORT", "8810"))

os.makedirs(DATA_DIR, exist_ok=True)
