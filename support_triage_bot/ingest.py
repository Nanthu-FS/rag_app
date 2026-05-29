"""Build the per-domain vector stores from the knowledge/ folder.

Run from the project root:   python ingest.py
"""
import os
import shutil
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from backend import config, rag


def main():
    for category in config.CATEGORIES:
        path = rag.store_path(category)
        if os.path.exists(path):
            shutil.rmtree(path)
        print(f"  ▸ Building '{category}' knowledge base …", flush=True)
        store = rag.build_store(category)
        count = store._collection.count()
        print(f"    ✓ {category}: {count} chunks indexed", flush=True)
    print("\nDone. All domain knowledge bases are ready.")


if __name__ == "__main__":
    print("Ingesting knowledge bases with Ollama embeddings "
          f"({config.EMBED_MODEL}) …\n")
    main()
