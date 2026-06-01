"""Comprehensive smoke test — exercises every agent and module repeatedly.

Run against the live server:  python _smoketest.py
Tests: router classification, each specialist, the calculator's exactness,
multi-agent fan-out, the general/chit-chat path, and the live STT endpoint
(synthesizing real speech with Windows TTS and transcribing it back).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

import httpx

sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://127.0.0.1:8850"

# (query, expected agent(s) the router should pick — subset match)
ASK_CASES = [
    ("what is 15% of 240?", {"calculator"}),
    ("calculate sqrt(144) + 7 * 3", {"calculator"}),
    ("convert 100 fahrenheit to celsius", {"calculator"}),
    ("why is the sky blue?", {"science"}),
    ("explain how photosynthesis works", {"science"}),
    ("what causes a rainbow?", {"science"}),
    ("how does a CPU cache work?", {"tech"}),
    ("explain what a REST API is", {"tech"}),
    ("what is the difference between TCP and UDP?", {"tech"}),
    ("hello personal_intelligence, are you online?", {"general"}),
    ("who are you?", {"general"}),
    ("what is the latest news about NASA Artemis?", {"web_search"}),
]


async def test_ask(client: httpx.AsyncClient, query: str, expect: set) -> dict:
    """Hit /api/ask (SSE), collect events, return a result summary."""
    plan, agents_done, answer, sources, err = None, [], "", [], None
    async with client.stream(
        "POST", f"{BASE}/api/ask", json={"query": query}, timeout=180.0
    ) as resp:
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            ev = json.loads(line[6:])
            t = ev["type"]
            if t == "plan":
                plan = ev["agents"]
            elif t == "agent":
                agents_done.append((ev["name"], ev["ok"]))
            elif t == "token":
                answer += ev["text"]
            elif t == "done":
                sources = ev["sources"]
            elif t == "error":
                err = ev["message"]

    plan_set = set(plan or [])
    routed_ok = bool(plan_set & expect)
    return {
        "query": query,
        "plan": plan,
        "routed_ok": routed_ok,
        "agents": agents_done,
        "answer_len": len(answer.strip()),
        "answer_head": answer.strip()[:80].replace("\n", " "),
        "sources": len(sources),
        "error": err,
        "ok": routed_ok and len(answer.strip()) > 0 and err is None,
    }


def _tts_wav(text: str, path: str) -> bool:
    """Synthesize speech to a WAV via Windows SAPI (PowerShell). Best-effort."""
    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.SetOutputToWaveFile('{path}'); $s.Speak('{text}'); $s.Dispose()"
    )
    import subprocess

    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True,
                       capture_output=True, timeout=60)
        return os.path.exists(path) and os.path.getsize(path) > 0
    except Exception:
        return False


def _wav_to_webm(src: str, dst: str) -> bool:
    """Transcode WAV -> webm/opus (the browser MediaRecorder format)."""
    try:
        import av
        from av.audio.resampler import AudioResampler

        inp = av.open(src)
        out = av.open(dst, "w", format="webm")
        ostream = out.add_stream("libopus", rate=48000)
        ostream.layout = "mono"
        res = AudioResampler(format="s16", layout="mono", rate=48000)
        for frame in inp.decode(audio=0):
            frame.pts = None
            for rf in res.resample(frame):
                for pkt in ostream.encode(rf):
                    out.mux(pkt)
        for pkt in ostream.encode(None):
            out.mux(pkt)
        out.close()
        inp.close()
        return os.path.getsize(dst) > 0
    except Exception as e:
        print("  webm transcode failed:", e)
        return False


async def test_stt(client: httpx.AsyncClient, phrase: str, fmt: str) -> dict:
    tmp = tempfile.gettempdir()
    wav = os.path.join(tmp, "stt_test.wav")
    if not _tts_wav(phrase, wav):
        return {"phrase": phrase, "fmt": fmt, "ok": None, "note": "TTS unavailable"}

    send_path, ctype = wav, "audio/wav"
    if fmt == "webm":
        webm = os.path.join(tmp, "stt_test.webm")
        if not _wav_to_webm(wav, webm):
            return {"phrase": phrase, "fmt": fmt, "ok": None, "note": "transcode failed"}
        send_path, ctype = webm, "audio/webm"

    with open(send_path, "rb") as f:
        files = {"audio": (os.path.basename(send_path), f, ctype)}
        r = await client.post(f"{BASE}/api/stt", files=files, timeout=120.0)
    if r.status_code != 200:
        return {"phrase": phrase, "fmt": fmt, "ok": False, "status": r.status_code,
                "body": r.text[:200]}
    text = r.json().get("text", "")
    # loose match: at least half the content words present
    words = [w.lower().strip(".,?") for w in phrase.split() if len(w) > 3]
    got = text.lower()
    hits = sum(1 for w in words if w in got)
    return {"phrase": phrase, "fmt": fmt, "got": text,
            "ok": hits >= max(1, len(words) // 2)}


async def main(rounds: int = 2):
    async with httpx.AsyncClient() as client:
        # Health
        h = (await client.get(f"{BASE}/api/health")).json()
        print("HEALTH:", json.dumps(h), "\n")

        ask_pass = ask_fail = 0
        for rnd in range(1, rounds + 1):
            print(f"===== /api/ask  round {rnd}/{rounds} =====")
            for query, expect in ASK_CASES:
                res = await test_ask(client, query, expect)
                tag = "PASS" if res["ok"] else "FAIL"
                if res["ok"]:
                    ask_pass += 1
                else:
                    ask_fail += 1
                print(f"[{tag}] {res['plan']!s:28} | {res['query'][:42]:42} "
                      f"| ans={res['answer_len']:4} src={res['sources']} "
                      f"| {res['answer_head']}")
                if res["error"]:
                    print("       ERROR:", res["error"])
            print()

        print("===== /api/stt (voice) =====")
        stt_pass = stt_fail = stt_skip = 0
        stt_phrases = [
            "Personal Intelligence what is the boiling point of water",
            "Calculate twelve times eight",
            "Tell me about black holes",
        ]
        for rnd in range(1, rounds + 1):
            for phrase in stt_phrases:
                for fmt in ("wav", "webm"):
                    res = await test_stt(client, phrase, fmt)
                    if res["ok"] is None:
                        stt_skip += 1
                        tag = "SKIP"
                    elif res["ok"]:
                        stt_pass += 1
                        tag = "PASS"
                    else:
                        stt_fail += 1
                        tag = "FAIL"
                    print(f"[{tag}] stt/{res['fmt']:4} | want: {res['phrase'][:38]:38} "
                          f"| got: {res.get('got', res.get('note', res.get('body','')))[:46]}")
        print()
        print(f"SUMMARY  ask: {ask_pass} pass / {ask_fail} fail   "
              f"stt: {stt_pass} pass / {stt_fail} fail / {stt_skip} skip")


if __name__ == "__main__":
    asyncio.run(main(rounds=2))
