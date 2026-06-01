"""Voice I/O for Personal Intelligence. Phase 1: local speech-to-text via faster-whisper.

Text-to-speech is handled client-side by the browser's Web Speech API (an en-GB
voice gives Personal Intelligence his accent with zero server plumbing). Swap in Piper/pyttsx3
server-side later for higher-fidelity, fully-offline TTS.
"""
