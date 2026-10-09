"""Index a local folder into a Chroma store, re-embedding only files that changed."""
import hashlib
import json
import os

from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".js", ".ts", ".html", ".xml", ".yaml", ".yml", ".ini", ".cfg"}
SUPPORTED_EXTS = TEXT_EXTS | {".pdf", ".docx"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "chroma_db", "$RECYCLE.BIN", "System Volume Information"}
MAX_FILE_MB = 50
MANIFEST = "folder_manifest.json"


def normalize(folder: str) -> str:
    return os.path.normcase(os.path.abspath(os.path.expanduser(folder.strip().strip('"'))))


def scan_folder(folder: str) -> dict[str, float]:
    """Return {path: mtime} for supported files under folder."""
    found = {}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            path = os.path.join(root, name)
            if os.path.splitext(name)[1].lower() not in SUPPORTED_EXTS:
                continue
            try:
                stat = os.stat(path)
            except OSError:
                continue
            if stat.st_size == 0 or stat.st_size > MAX_FILE_MB * 1024 * 1024:
                continue
            found[path] = stat.st_mtime
    return found


def load_file(path: str) -> list:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        loader = PyPDFLoader(path)
    elif ext == ".docx":
        loader = Docx2txtLoader(path)
    else:
        loader = TextLoader(path, encoding="utf-8", autodetect_encoding=True)
    return loader.load()


def _manifest_path(persist_dir: str) -> str:
    return os.path.join(persist_dir, MANIFEST)


def load_manifest(persist_dir: str) -> dict:
    try:
        with open(_manifest_path(persist_dir), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_manifest(persist_dir: str, manifest: dict):
    os.makedirs(persist_dir, exist_ok=True)
    with open(_manifest_path(persist_dir), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)


def _chunk_id(path: str, i: int) -> str:
    return hashlib.sha1(f"{path}::{i}".encode("utf-8")).hexdigest()


def index_folder(folder: str, vectorstore: Chroma, persist_dir: str, progress=None) -> dict:
    """Sync folder into vectorstore. Returns counts of added/updated/removed/failed files."""
    folder = normalize(folder)
    if not os.path.isdir(folder):
        raise FileNotFoundError(f"Not a folder: {folder}")

    manifest = load_manifest(persist_dir)
    known = manifest.get(folder, {})
    current = scan_folder(folder)

    removed = [p for p in known if p not in current]
    changed = [p for p, m in current.items() if known.get(p, {}).get("mtime") != m]
    stats = {"added": 0, "updated": 0, "removed": len(removed), "failed": [], "files": len(current)}

    for path in removed:
        vectorstore.delete(where={"source_path": path})
        known.pop(path, None)

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    for n, path in enumerate(changed, 1):
        if progress:
            progress(n / len(changed), os.path.relpath(path, folder))
        try:
            docs = load_file(path)
        except Exception as e:  # unreadable/corrupt file: skip it, keep going
            stats["failed"].append(f"{os.path.relpath(path, folder)}: {e}")
            # remember it so unchanged broken files aren't retried on every sync
            if path in known:
                vectorstore.delete(where={"source_path": path})
            known[path] = {"mtime": current[path], "chunks": 0, "error": str(e)}
            continue
        rel = os.path.relpath(path, folder)
        for d in docs:
            d.metadata = {
                "source": rel,
                "source_path": path,
                "folder": folder,
                "page": d.metadata.get("page", 0) + 1 if "page" in d.metadata else "",
            }
        chunks = [c for c in splitter.split_documents(docs) if c.page_content.strip()]
        if path in known:
            vectorstore.delete(where={"source_path": path})
            stats["updated"] += 1
        else:
            stats["added"] += 1
        if chunks:
            vectorstore.add_documents(chunks, ids=[_chunk_id(path, i) for i in range(len(chunks))])
        known[path] = {"mtime": current[path], "chunks": len(chunks)}
        # save as we go so a crash mid-index doesn't redo finished files
        manifest[folder] = known
        save_manifest(persist_dir, manifest)

    manifest[folder] = known
    save_manifest(persist_dir, manifest)
    return stats


def indexed_folders(persist_dir: str) -> dict[str, int]:
    """{folder: file count} for folders already indexed with this embedding model."""
    return {f: len(files) for f, files in load_manifest(persist_dir).items()}


def forget_folder(folder: str, vectorstore: Chroma, persist_dir: str):
    vectorstore.delete(where={"folder": folder})
    manifest = load_manifest(persist_dir)
    manifest.pop(folder, None)
    save_manifest(persist_dir, manifest)
