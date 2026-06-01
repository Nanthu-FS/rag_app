"""Local speech-to-text using faster-whisper (CTranslate2).

The model is loaded lazily on first use and cached for the process lifetime, so
it stays resident on the GPU between utterances. On a 4070 Ti Super the ``small``
model on CUDA/float16 transcribes a short push-to-talk clip in well under a second
while leaving plenty of VRAM for the 14B brain.

Env:
  PI_WHISPER_MODEL    default "small"   (tiny|base|small|medium|large-v3)
  PI_WHISPER_DEVICE   default "cuda"    (falls back to cpu/int8 if cuda fails)
  PI_WHISPER_COMPUTE  default "float16"
"""

from __future__ import annotations

import glob
import os
import struct
import tempfile

_MODEL = None  # cached WhisperModel


def _register_cuda_dlls() -> None:
    """Put the pip-installed CUDA 12 runtime DLLs on the Windows search path.

    CTranslate2 (faster-whisper's backend) needs cublas64_12.dll + cuDNN at
    inference time. The ``nvidia-cublas-cu12`` / ``nvidia-cudnn-cu12`` wheels drop
    them under site-packages\\nvidia\\*\\bin, which is NOT searched by default on
    Windows — so we register those dirs explicitly. Harmless no-op elsewhere.
    """
    if not hasattr(os, "add_dll_directory"):
        return
    try:
        import nvidia  # type: ignore
    except ImportError:
        return
    # ``nvidia`` is a namespace package (no __file__); iterate its path roots.
    bindirs = []
    for base in list(getattr(nvidia, "__path__", [])):
        bindirs.extend(glob.glob(os.path.join(base, "*", "bin")))
    for bindir in bindirs:
        try:
            os.add_dll_directory(bindir)
        except OSError:
            pass
    # CTranslate2 resolves cuBLAS/cuDNN via the legacy PATH search, NOT
    # add_dll_directory — so prepend the dirs to PATH too, before it's imported.
    if bindirs:
        os.environ["PATH"] = os.pathsep.join(bindirs) + os.pathsep + os.environ.get("PATH", "")


def _build(name: str, device: str, compute: str):
    """Construct a WhisperModel and warm it up so CUDA-runtime failures surface
    here (where we can fall back) rather than on the first real request."""
    from faster_whisper import WhisperModel  # imported lazily — heavy dep

    model = WhisperModel(name, device=device, compute_type=compute)
    # 0.1s of silence: forces an encode pass that exercises cuBLAS/cuDNN now.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(_silence_wav(0.1))
        warm = tmp.name
    try:
        list(model.transcribe(warm, beam_size=1)[0])
    finally:
        try:
            os.unlink(warm)
        except OSError:
            pass
    return model


def _load():
    """Load (once) and return the faster-whisper model.

    Tries CUDA first (fast on the 4070 Ti Super), but warms up the model so any
    missing-CUDA-library failure is caught and we cleanly fall back to CPU/int8 —
    CPU ``small`` still transcribes a short push-to-talk clip in ~1-2s.
    """
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    name = os.environ.get("PI_WHISPER_MODEL", "small")
    device = os.environ.get("PI_WHISPER_DEVICE", "cuda")
    compute = os.environ.get("PI_WHISPER_COMPUTE", "float16")

    if device == "cuda":
        _register_cuda_dlls()
        try:
            _MODEL = _build(name, "cuda", compute)
            return _MODEL
        except Exception as e:  # missing cuBLAS/cuDNN, VRAM pressure, etc.
            print(f"[stt] CUDA unavailable ({e}); falling back to CPU.", flush=True)

    _MODEL = _build(name, "cpu", "int8")
    return _MODEL


def _silence_wav(seconds: float, rate: int = 16000) -> bytes:
    """A minimal mono 16-bit PCM WAV of silence, for model warmup."""
    n = int(seconds * rate)
    data = b"\x00\x00" * n
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 1, 1,
        rate, rate * 2, 2, 16, b"data", len(data),
    )
    return header + data


def transcribe_bytes(audio: bytes, suffix: str = ".webm") -> str:
    """Transcribe raw audio bytes (any format PyAV can decode) to text.

    The browser's MediaRecorder produces webm/opus by default; faster-whisper
    decodes it via PyAV, so we just persist the blob to a temp file and run it.
    """
    if not audio:
        return ""

    model = _load()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio)
        path = tmp.name

    try:
        segments, _info = model.transcribe(path, beam_size=1, vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
