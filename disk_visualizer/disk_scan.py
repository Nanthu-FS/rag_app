"""Fast recursive disk usage scanner with an in-memory folder index."""

import heapq
import os
import string
import threading
import time
from concurrent.futures import ThreadPoolExecutor

CATEGORIES = {
    "video": ".mp4 .mkv .avi .mov .wmv .webm .m4v .flv .mpg .mpeg .ts .vob",
    "images": ".jpg .jpeg .png .gif .bmp .tif .tiff .psd .raw .cr2 .nef .heic .webp .svg .ico .dng",
    "audio": ".mp3 .wav .flac .aac .ogg .m4a .wma .opus",
    "archives": ".zip .rar .7z .tar .gz .tgz .bz2 .xz .iso .img .dmg .cab .vhd .vhdx .wim",
    "apps": ".exe .dll .msi .sys .bin .so .dylib .appx .msix .pak .vdf .esd",
    "docs": ".pdf .doc .docx .xls .xlsx .ppt .pptx .txt .md .csv .rtf .odt .epub .one .pst .ost",
    "code": ".js .ts .jsx .tsx .py .pyc .java .class .jar .c .cpp .h .cs .go .rs .rb .php .json .map .node .whl .onnx .pt .pth .ckpt .safetensors .gguf .ipynb .lock",
}
CAT_OF = {ext: cat for cat, exts in CATEGORIES.items() for ext in exts.split()}
STALE_AGE = 365 * 86400
TOP_FILES = 24
TOP_EXTS = 24
REPARSE_LINK_TAGS = {0xA0000003, 0xA000000C}  # mount point (junction), symlink

DEV_JUNK = {"node_modules", "__pycache__", ".venv", "venv", ".gradle", ".next", ".nuget", ".tox", ".pytest_cache", ".mypy_cache", ".parcel-cache", "bower_components"}
CACHE_NAMES = {"temp", "tmp", "cache", ".cache", "caches", "cache2", "inetcache", "crashdumps", "code cache", "gpucache", "npm-cache", "pip", "d3dscache"}
INSTALLER_EXTS = {".exe", ".msi", ".iso", ".zip", ".rar", ".7z", ".dmg", ".img"}


class Node:
    __slots__ = ("name", "path", "size", "files", "dirs", "children", "top", "cats", "exts", "stale", "parent", "error")

    def __init__(self, name, path, parent=None):
        self.name, self.path, self.parent = name, path, parent
        self.size = self.files = self.dirs = self.stale = 0
        self.children, self.top, self.cats, self.exts = [], [], {}, {}
        self.error = False


def _key(path):
    return os.path.normcase(os.path.abspath(path)).rstrip("\\/") or os.sep


def _is_link(entry):
    if entry.is_symlink():
        return True
    if os.name == "nt":
        try:
            return getattr(entry.stat(follow_symlinks=False), "st_reparse_tag", 0) in REPARSE_LINK_TAGS
        except OSError:
            return False
    return False


class Scanner:
    def __init__(self):
        self.root = None
        self.index = {}
        self.running = False
        self.cancel = False
        self.files = self.bytes = self.errors = 0
        self.current = ""
        self.started = self.finished = 0.0
        self.target = ""

    # ---------------- scanning ----------------
    def start(self, path):
        if self.running:
            return False
        path = os.path.abspath(os.path.expanduser(path))
        if not os.path.isdir(path):
            return False
        self.running, self.cancel = True, False
        self.files = self.bytes = self.errors = 0
        self.started, self.finished, self.target = time.time(), 0.0, path
        threading.Thread(target=self._run, args=(path,), daemon=True).start()
        return True

    def stop(self):
        self.cancel = True

    def progress(self):
        return {
            "running": self.running, "files": self.files, "bytes": self.bytes, "errors": self.errors,
            "current": self.current, "target": self.target, "cancelled": self.cancel,
            "elapsed": (self.finished or time.time()) - self.started if self.started else 0,
            "ready": self.root is not None and not self.running,
        }

    def _run(self, path):
        try:
            now = time.time()
            name = os.path.basename(path.rstrip("\\/")) or path
            root = Node(name, path)
            index = {_key(path): root}
            kids = self._list(root, now, index)
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda c: self._walk(c, now, index), kids))
            self._aggregate(root)
            self.root, self.index = root, index
        finally:
            self.running = False
            self.finished = time.time()

    def _walk(self, node, now, index):
        for child in self._list(node, now, index):
            if self.cancel:
                break
            self._walk(child, now, index)
        self._aggregate(node)

    def _list(self, node, now, index):
        kids = []
        try:
            it = os.scandir(node.path)
        except OSError:
            node.error = True
            self.errors += 1
            return kids
        self.current = node.path
        with it:
            for e in it:
                if self.cancel:
                    break
                try:
                    if e.is_dir(follow_symlinks=False):
                        if not _is_link(e):
                            kids.append(Node(e.name, e.path, node))
                        continue
                    if not e.is_file(follow_symlinks=False):
                        continue
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                sz = st.st_size
                ext = os.path.splitext(e.name)[1].lower()
                node.size += sz
                node.files += 1
                cat = CAT_OF.get(ext, "other")
                node.cats[cat] = node.cats.get(cat, 0) + sz
                ext = ext or "(none)"
                node.exts[ext] = node.exts.get(ext, 0) + sz
                if now - st.st_mtime > STALE_AGE:
                    node.stale += sz
                item = (sz, e.name, st.st_mtime)
                if len(node.top) < TOP_FILES:
                    heapq.heappush(node.top, item)
                elif sz > node.top[0][0]:
                    heapq.heapreplace(node.top, item)
                self.files += 1
                self.bytes += sz
        node.children = kids
        for c in kids:
            index[_key(c.path)] = c
        return kids

    @staticmethod
    def _aggregate(node):
        node.dirs = len(node.children)
        for c in node.children:
            node.size += c.size
            node.files += c.files
            node.dirs += c.dirs
            node.stale += c.stale
            for k, v in c.cats.items():
                node.cats[k] = node.cats.get(k, 0) + v
            for k, v in c.exts.items():
                node.exts[k] = node.exts.get(k, 0) + v
        if len(node.exts) > TOP_EXTS:
            node.exts = dict(sorted(node.exts.items(), key=lambda kv: -kv[1])[:TOP_EXTS])
        node.children.sort(key=lambda c: -c.size)

    # ---------------- queries ----------------
    def node(self, path):
        return self.index.get(_key(path)) if path else self.root

    def _subtree(self, node):
        stack = [node]
        while stack:
            n = stack.pop()
            yield n
            stack.extend(n.children)

    @staticmethod
    def _files(n, limit):
        return [{"name": nm, "size": s, "mtime": m, "path": os.path.join(n.path, nm)} for s, nm, m in sorted(n.top, reverse=True)[:limit]]

    def _json(self, n, depth, top, files):
        d = {
            "path": n.path, "name": n.name, "size": n.size, "files": n.files, "dirs": n.dirs,
            "cats": n.cats, "stale": n.stale, "error": n.error, "top_files": self._files(n, files),
        }
        if depth > 0:
            kids, rest = n.children[:top], n.children[top:]
            d["children"] = [self._json(c, depth - 1, 4, 2 if depth == 2 else 0) for c in kids]
            d["other"] = {"size": sum(c.size for c in rest), "count": len(rest)}
        return d

    def tree(self, path=None):
        n = self.node(path)
        if not n:
            return None
        d = self._json(n, 2, 18, 6)
        d["parent"] = n.parent.path if n.parent else None
        d["root"] = self.root.path
        crumbs, p = [], n
        while p:
            crumbs.append({"name": p.name, "path": p.path})
            p = p.parent
        d["crumbs"] = crumbs[::-1]
        return d

    def details(self, path=None):
        n = self.node(path)
        if not n:
            return None
        heap = []
        stale = []
        now = time.time()
        for sub in self._subtree(n):
            for s, nm, m in sub.top:
                item = (s, nm, m, sub.path)
                if len(heap) < 60:
                    heapq.heappush(heap, item)
                elif s > heap[0][0]:
                    heapq.heapreplace(heap, item)
                if now - m > STALE_AGE:
                    if len(stale) < 40:
                        heapq.heappush(stale, item)
                    elif s > stale[0][0]:
                        heapq.heapreplace(stale, item)
        fmt = lambda items: [{"name": nm, "size": s, "mtime": m, "path": os.path.join(p, nm), "dir": p} for s, nm, m, p in sorted(items, reverse=True)]
        return {
            "path": n.path, "name": n.name, "size": n.size, "files": n.files, "dirs": n.dirs, "cats": n.cats, "stale": n.stale,
            "largest": fmt(heap), "stale_files": fmt(stale),
            "exts": sorted(({"ext": k, "size": v} for k, v in n.exts.items()), key=lambda e: -e["size"]),
            "subfolders": [{"name": c.name, "path": c.path, "size": c.size, "files": c.files, "cats": c.cats} for c in n.children[:60]],
        }

    def insights(self, path=None):
        n = self.node(path)
        if not n:
            return []
        groups = {"dev": [], "cache": [], "recycle": [], "downloads": []}
        big, installers = [], []
        stack = [n]
        while stack:
            x = stack.pop()
            low = x.name.lower()
            if x is not n and low in DEV_JUNK:
                groups["dev"].append(x)
                continue
            if x is not n and low in CACHE_NAMES:
                groups["cache"].append(x)
                continue
            if low == "$recycle.bin":
                groups["recycle"].append(x)
                continue
            if low == "downloads":
                groups["downloads"].append(x)
            for s, nm, m in x.top:
                if s >= 1 << 30:
                    big.append((s, nm, x.path))
                if s >= 100 << 20 and os.path.splitext(nm)[1].lower() in INSTALLER_EXTS and "download" in x.path.lower():
                    installers.append((s, nm, x.path))
            stack.extend(x.children)

        def folders(lst):
            lst = sorted(lst, key=lambda c: -c.size)
            return sum(c.size for c in lst), [{"name": c.name, "path": c.path, "size": c.size, "kind": "dir"} for c in lst[:8]]

        def files(lst):
            lst = sorted(lst, reverse=True)
            return sum(s for s, _, _ in lst), [{"name": nm, "path": os.path.join(p, nm), "size": s, "kind": "file"} for s, nm, p in lst[:8]]

        cards = []
        for key, title, text, lvl in [
            ("dev", "Dev dependencies & build caches", "{n} folders like node_modules, .venv and __pycache__ can be regenerated.", "warn"),
            ("cache", "Temp & cache folders", "{n} temp/cache folders are usually safe to clear.", "warn"),
            ("recycle", "Recycle Bin", "Deleted files still taking space.", "crit"),
            ("downloads", "Downloads", "Your downloads folder{s} often hide forgotten installers and videos.", "info"),
        ]:
            total, items = folders(groups[key])
            if total:
                cards.append({"lvl": lvl, "title": title, "size": total, "items": items,
                              "text": text.format(n=len(groups[key]), s="s" if len(groups[key]) > 1 else "")})
        total, items = files(big)
        if total:
            cards.append({"lvl": "info", "title": "Huge files (1 GB+)", "size": total, "items": items, "text": f"{len(big)} files over 1 GB."})
        total, items = files(installers)
        if total:
            cards.append({"lvl": "warn", "title": "Old installers & archives", "size": total, "items": items, "text": "Setup files and archives in Downloads you probably no longer need."})
        if n.stale:
            cards.append({"lvl": "info", "title": "Untouched for a year", "size": n.stale, "items": [],
                          "text": f"{n.stale / max(n.size, 1):.0%} of this folder hasn't been modified in 12+ months. Consider archiving."})
        cards.sort(key=lambda c: -c["size"])
        return cards

    def search(self, q, path=None, limit=24):
        n = self.node(path)
        q = (q or "").strip().lower()
        if not n or not q:
            return []
        out = []
        ext_q = q if q.startswith(".") else None
        for x in self._subtree(n):
            if not ext_q and q in x.name.lower() and x is not n:
                out.append({"name": x.name, "path": x.path, "size": x.size, "kind": "dir"})
            for s, nm, m in x.top:
                low = nm.lower()
                if (ext_q and low.endswith(ext_q)) or (not ext_q and q in low):
                    out.append({"name": nm, "path": os.path.join(x.path, nm), "size": s, "kind": "file"})
        out.sort(key=lambda r: -r["size"])
        return out[:limit]

    def remove(self, path):
        """Drop a deleted file or folder from the in-memory tree, fixing sizes up the chain."""
        n = self.node(path)
        if n and n.parent:
            n.parent.children.remove(n)
            for k in [k for k in self.index if k == _key(n.path) or k.startswith(_key(n.path) + os.sep)]:
                del self.index[k]
            size, files, dirs, parent = n.size, n.files, n.dirs + 1, n.parent
        else:
            parent = self.node(os.path.dirname(path))
            if not parent:
                return
            hit = [t for t in parent.top if t[1] == os.path.basename(path)]
            if not hit:
                return
            parent.top.remove(hit[0])
            heapq.heapify(parent.top)
            size, files, dirs = hit[0][0], 1, 0
        p = parent
        while p:
            p.size -= size
            p.files -= files
            p.dirs -= dirs
            p = p.parent


def drives():
    out = []
    if os.name == "nt":
        import ctypes
        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            if not os.path.exists(root):
                continue
            try:
                usage = __import__("shutil").disk_usage(root)
            except OSError:
                continue
            buf = ctypes.create_unicode_buffer(261)
            ctypes.windll.kernel32.GetVolumeInformationW(root, buf, 261, None, None, None, None, 0)
            out.append({"path": root, "label": buf.value or "Local Disk", "total": usage.total, "used": usage.used, "free": usage.free})
    else:
        import shutil
        for root, label in [("/", "System"), (os.path.expanduser("~"), "Home")]:
            u = shutil.disk_usage(root)
            out.append({"path": root, "label": label, "total": u.total, "used": u.used, "free": u.free})
    return out
