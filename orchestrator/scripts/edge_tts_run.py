"""Free neural TTS via Microsoft Edge's read-aloud voices (pip package `edge-tts`).

  python edge_tts_run.py speak --voice ur-PK-UzmaNeural --text-file in.txt --out a.mp3 --meta a.words.json [--rate +0%]
  python edge_tts_run.py list            # prints JSON list of voices

The words file is a JSON list of {text, start, end} in seconds, used for captions.
"""
import argparse
import asyncio
import json
import sys

import edge_tts


async def speak(a):
    text = open(a.text_file, encoding="utf-8").read().strip()
    try:
        comm = edge_tts.Communicate(text, a.voice, rate=a.rate, boundary="WordBoundary")
    except TypeError:  # edge-tts < 7 always sends word boundaries and has no `boundary` arg
        comm = edge_tts.Communicate(text, a.voice, rate=a.rate)
    words = []
    with open(a.out, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"text": chunk["text"], "start": start, "end": start + chunk["duration"] / 1e7})
    with open(a.meta, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)


async def list_voices():
    voices = await edge_tts.list_voices()
    out = [{"id": v["ShortName"], "locale": v["Locale"], "gender": v["Gender"],
            "tags": ", ".join(v.get("VoiceTag", {}).get("VoicePersonalities", []) or [])} for v in voices]
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("speak")
    s.add_argument("--voice", required=True)
    s.add_argument("--text-file", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--meta", required=True)
    s.add_argument("--rate", default="+0%")
    sub.add_parser("list")
    a = p.parse_args()
    asyncio.run(speak(a) if a.cmd == "speak" else list_voices())


if __name__ == "__main__":
    main()
