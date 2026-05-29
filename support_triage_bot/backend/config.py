"""Central configuration for the triage bot.

Every model / threshold is overridable via environment variables so the app can
be tuned without touching code.
"""
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
KNOWLEDGE_DIR = os.path.join(PROJECT_DIR, "knowledge")
VECTOR_DIR = os.path.join(PROJECT_DIR, "vectorstores")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")

# ── Models (local, via Ollama) ────────────────────────────────────────────────
# A small fast model classifies/routes; the same or a larger one writes answers.
CLASSIFIER_MODEL = os.getenv("TRIAGE_CLASSIFIER_MODEL", "llama3.2:3b")
ANSWER_MODEL = os.getenv("TRIAGE_ANSWER_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("TRIAGE_EMBED_MODEL", "nomic-embed-text:latest")

# ── Domains ─────────────────────────────────────────────────────────────────
CATEGORIES = ["billing", "technical", "general"]

# ── Retrieval / escalation tuning ─────────────────────────────────────────────
TOP_K = int(os.getenv("TRIAGE_TOP_K", "4"))
MIN_CONFIDENCE = float(os.getenv("TRIAGE_MIN_CONFIDENCE", "0.45"))  # below → escalate
MIN_RETRIEVAL = float(os.getenv("TRIAGE_MIN_RETRIEVAL", "0.15"))    # below → escalate

HOST = os.getenv("TRIAGE_HOST", "127.0.0.1")
PORT = int(os.getenv("TRIAGE_PORT", "8800"))
