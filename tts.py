#!/usr/bin/env python3
"""Hazel TTS — free neural text-to-speech via Microsoft Edge TTS (no API key).

Usage:
    python3 tts.py "<text>" "<voice>" "<out.mp3>"

Writes an mp3 to `out`. Exits 0 on success, non-zero on failure.
Used by the Hazel backend (src/tts.js) to synthesize real spoken audio.
"""
import sys, asyncio, json

try:
    import edge_tts
except Exception as e:
    print(json.dumps({"ok": False, "error": "edge_tts not importable: %s" % e}))
    sys.exit(2)

DEFAULT_VOICE = "en-US-JennyNeural"

async def synth(text, voice, out):
    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")
    comm = edge_tts.Communicate(text, voice or DEFAULT_VOICE, rate="+0%")
    await comm.save(out)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "text required"}))
        sys.exit(3)
    text = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else DEFAULT_VOICE
    out = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else "/tmp/hazel_tts.mp3"
    try:
        asyncio.run(synth(text, voice, out))
        print(json.dumps({"ok": True, "out": out, "voice": voice}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
