"""Persistent history of analyzed images stored in a JSON file."""
import json
import os
import threading
import uuid
from datetime import datetime
from . import config

_lock = threading.Lock()


def _load() -> list:
    if not os.path.exists(config.HISTORY_FILE):
        return []
    try:
        with open(config.HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(records: list):
    with open(config.HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def add_record(record: dict) -> dict:
    with _lock:
        records = _load()
        record["id"] = str(uuid.uuid4())[:8]
        record["analyzed_at"] = datetime.now().isoformat(timespec="seconds")
        records.insert(0, record)
        records = records[:200]        # keep last 200
        _save(records)
    return record


def get_all() -> list:
    with _lock:
        return _load()


def clear():
    with _lock:
        _save([])
