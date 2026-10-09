"""Discover local git repositories and collect their status."""

import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

SKIP_DIRS = {
    "node_modules", ".venv", "venv", "__pycache__", ".idea", ".vs",
    "AppData", "$Recycle.Bin", "Program Files", "Program Files (x86)", "Windows",
}
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def git(path, *args, timeout=15):
    """Run a git command in `path` and return stdout ('' on failure)."""
    try:
        out = subprocess.run(
            ["git", "-C", path, *args],
            capture_output=True, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=CREATE_NO_WINDOW,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def git_result(path, *args, timeout=120):
    """Run a git command and return (ok, combined output) for user actions."""
    try:
        out = subprocess.run(
            ["git", "-C", path, *args],
            capture_output=True, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, creationflags=CREATE_NO_WINDOW,
        )
        return out.returncode == 0, (out.stdout + out.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def find_repos(roots, max_depth=4):
    """Walk each root folder and return paths that contain a .git entry."""
    found = []
    for root in roots:
        root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(root):
            continue
        base_depth = root.rstrip(os.sep).count(os.sep)
        for dirpath, dirnames, _ in os.walk(root):
            if ".git" in dirnames or os.path.isfile(os.path.join(dirpath, ".git")):
                found.append(dirpath)
                dirnames[:] = []  # don't descend into a repo
                continue
            if dirpath.count(os.sep) - base_depth >= max_depth:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
    return sorted(set(found), key=str.lower)


def parse_status(porcelain):
    counts = {"modified": 0, "added": 0, "deleted": 0, "untracked": 0, "conflicts": 0}
    files = []
    for line in porcelain.splitlines():
        if len(line) < 4:
            continue
        code, name = line[:2], line[3:]
        if code == "??":
            counts["untracked"] += 1
            kind = "untracked"
        elif "U" in code or code in ("AA", "DD"):
            counts["conflicts"] += 1
            kind = "conflict"
        elif "D" in code:
            counts["deleted"] += 1
            kind = "deleted"
        elif "A" in code:
            counts["added"] += 1
            kind = "added"
        else:
            counts["modified"] += 1
            kind = "modified"
        files.append({"name": name, "kind": kind})
    return counts, files


def repo_summary(path):
    """Fast status used for the overview graph."""
    branch = git(path, "rev-parse", "--abbrev-ref", "HEAD") or "?"
    counts, files = parse_status(git(path, "status", "--porcelain"))
    ahead = behind = 0
    upstream = git(path, "rev-parse", "--abbrev-ref", "@{u}")
    if upstream:
        lr = git(path, "rev-list", "--left-right", "--count", "@{u}...HEAD").split()
        if len(lr) == 2:
            behind, ahead = int(lr[0]), int(lr[1])
    last = git(path, "log", "-1", "--format=%h%x1f%s%x1f%an%x1f%ct")
    last_commit = None
    if last:
        h, s, a, t = (last.split("\x1f") + ["", "", "", "0"])[:4]
        last_commit = {"hash": h, "subject": s, "author": a, "time": int(t or 0)}
    branches = [b for b in git(path, "branch", "--format=%(refname:short)").splitlines() if b]
    stashes = len([s for s in git(path, "stash", "list").splitlines() if s])
    changed = sum(counts.values())
    return {
        "path": path,
        "name": os.path.basename(path.rstrip("\\/")) or path,
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "changed": changed,
        "counts": counts,
        "files": files[:40],
        "branches": branches,
        "stashes": stashes,
        "last_commit": last_commit,
        "remote": git(path, "remote", "get-url", "origin"),
        "health": health_score(changed, ahead, behind, counts["conflicts"], upstream, last_commit),
    }


def health_score(changed, ahead, behind, conflicts, upstream, last_commit):
    score = 100
    score -= min(changed * 3, 30)
    score -= min(ahead * 4, 20)
    score -= min(behind * 5, 25)
    score -= conflicts * 15
    if not upstream:
        score -= 10
    if last_commit and time.time() - last_commit["time"] > 90 * 86400:
        score -= 10
    return max(score, 0)


def repo_detail(path, days=30):
    """Heavier data for the focus view: recent commits and daily activity."""
    data = repo_summary(path)
    log = git(path, "log", "-40", "--format=%h%x1f%s%x1f%an%x1f%ct%x1f%D")
    commits = []
    for line in log.splitlines():
        parts = (line.split("\x1f") + [""] * 5)[:5]
        commits.append({
            "hash": parts[0], "subject": parts[1], "author": parts[2],
            "time": int(parts[3] or 0), "refs": parts[4],
        })
    data["commits"] = commits

    since = int(time.time()) - days * 86400
    stamps = git(path, "log", "--all", f"--since={since}", "--format=%ct").split()
    activity = [0] * days
    now = time.time()
    for s in stamps:
        idx = days - 1 - int((now - int(s)) // 86400)
        if 0 <= idx < days:
            activity[idx] += 1
    data["activity"] = activity
    authors = git(path, "shortlog", "-sn", "--all", "--no-merges", timeout=20)
    data["contributors"] = [
        {"name": l.split("\t", 1)[1], "commits": int(l.split("\t", 1)[0])}
        for l in authors.splitlines() if "\t" in l
    ][:8]
    data["total_commits"] = int(git(path, "rev-list", "--count", "HEAD") or 0)
    data["tags"] = len(git(path, "tag").splitlines())
    return data


def scan(roots, workers=12):
    repos = find_repos(roots)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(repo_summary, repos))
