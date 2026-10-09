"""DiskPulse: a disk space visualizer for Windows (pywebview desktop app)."""

import getpass
import os
import subprocess
import sys

import webview

import disk_scan


def resource(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


class Api:
    def __init__(self):
        self._scanner = disk_scan.Scanner()
        self._window = None

    def info(self):
        return {"user": getpass.getuser(), "home": os.path.expanduser("~"), "drives": disk_scan.drives()}

    def drives(self):
        return disk_scan.drives()

    # ---- scanning ----
    def start_scan(self, path):
        return self._scanner.start(path)

    def stop_scan(self):
        self._scanner.stop()

    def progress(self):
        return self._scanner.progress()

    def pick_folder(self):
        kind = webview.FileDialog.FOLDER if hasattr(webview, "FileDialog") else webview.FOLDER_DIALOG
        picked = self._window.create_file_dialog(kind)
        return picked[0] if picked else None

    # ---- queries ----
    def tree(self, path=None):
        return self._scanner.tree(path)

    def details(self, path=None):
        return self._scanner.details(path)

    def insights(self, path=None):
        return self._scanner.insights(path)

    def search(self, q, path=None):
        return self._scanner.search(q, path)

    # ---- shell ----
    def open_folder(self, path):
        if os.name == "nt":
            os.startfile(path)
        else:
            subprocess.Popen(["xdg-open", path])

    def reveal(self, path):
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])

    def recycle(self, path):
        """Move a file or folder to the Recycle Bin (never a permanent delete)."""
        try:
            from send2trash import send2trash
            send2trash(os.path.normpath(path))
        except Exception as e:  # noqa: BLE001 - report any failure back to the UI
            return {"ok": False, "error": str(e)}
        self._scanner.remove(path)
        return {"ok": True}


def main():
    api = Api()
    window = webview.create_window(
        "DiskPulse",
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
