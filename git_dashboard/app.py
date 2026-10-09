"""RepoPulse: a Git repo dashboard for Windows (pywebview desktop app)."""

import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import webview

import git_scan

CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".repopulse.json")


def resource(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def default_roots():
    home = os.path.expanduser("~")
    candidates = ["source/repos", "Documents/GitHub", "projects", "Projects", "code", "dev", "repos"]
    roots = [os.path.join(home, c) for c in candidates if os.path.isdir(os.path.join(home, c))]
    return roots or [home]


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    cfg.setdefault("roots", default_roots())
    return cfg


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


class Api:
    def __init__(self):
        self._cfg = load_config()
        self._window = None

    # ---- data ----
    def get_config(self):
        return self._cfg

    def scan(self):
        user = git_scan.git(os.path.expanduser("~"), "config", "--global", "user.name")
        return {"roots": self._cfg["roots"], "repos": git_scan.scan(self._cfg["roots"]), "user": user}

    def detail(self, path):
        return git_scan.repo_detail(path)

    # ---- roots ----
    def add_root(self):
        folder_kind = webview.FileDialog.FOLDER if hasattr(webview, "FileDialog") else webview.FOLDER_DIALOG
        picked = self._window.create_file_dialog(folder_kind)
        if picked:
            folder = picked[0]
            if folder not in self._cfg["roots"]:
                self._cfg["roots"].append(folder)
                save_config(self._cfg)
        return self._cfg["roots"]

    def remove_root(self, folder):
        self._cfg["roots"] = [r for r in self._cfg["roots"] if r != folder]
        save_config(self._cfg)
        return self._cfg["roots"]

    # ---- git actions ----
    def fetch(self, path):
        ok, out = git_scan.git_result(path, "fetch", "--all", "--prune")
        return {"ok": ok, "output": out, "repo": git_scan.repo_summary(path)}

    def pull(self, path):
        ok, out = git_scan.git_result(path, "pull", "--ff-only")
        return {"ok": ok, "output": out, "repo": git_scan.repo_summary(path)}

    def push(self, path):
        ok, out = git_scan.git_result(path, "push")
        return {"ok": ok, "output": out, "repo": git_scan.repo_summary(path)}

    def fetch_all(self, paths):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(self.fetch, paths))
        return [{"ok": r["ok"], "repo": r["repo"]} for r in results]

    # ---- shell ----
    def open_folder(self, path):
        if os.name == "nt":
            os.startfile(path)
        else:
            subprocess.Popen(["xdg-open", path])

    def open_editor(self, path):
        code = shutil.which("code")
        if not code:
            return False
        subprocess.Popen([code, path], creationflags=git_scan.CREATE_NO_WINDOW)
        return True

    def open_terminal(self, path):
        if os.name == "nt":
            wt = shutil.which("wt")
            cmd = [wt, "-d", path] if wt else ["cmd", "/K", f'cd /d "{path}"']
            subprocess.Popen(cmd, creationflags=0 if wt else subprocess.CREATE_NEW_CONSOLE)
        else:
            subprocess.Popen(["x-terminal-emulator"], cwd=path)

    def open_remote(self, url):
        if url.startswith("git@"):
            url = "https://" + url[4:].replace(":", "/", 1)
        if url.endswith(".git"):
            url = url[:-4]
        if url.startswith("http"):
            import webbrowser
            webbrowser.open(url)


def main():
    api = Api()
    window = webview.create_window(
        "RepoPulse",
        resource("ui/index.html"),
        js_api=api,
        width=1480,
        height=940,
        min_size=(1100, 700),
        background_color="#050a0a",
    )
    api._window = window
    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
