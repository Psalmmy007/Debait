"""Records the voiceover with a neural voice (edge-tts) and saves when every word is spoken.

Output (in ad/out/vo/):
  <id>.mp3       one file per line of the script
  timing.json    duration of each line + start/end of every word, in seconds

Run from the repo root:  python ad/vo.py
"""
import asyncio
import json
import pathlib
import subprocess

import edge_tts

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "out" / "vo"
OUT.mkdir(parents=True, exist_ok=True)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


async def record(line, voice, rate, pitch):
    comm = edge_tts.Communicate(line["text"], voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    path = OUT / f"{line['id']}.mp3"
    with open(path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7  # 100-nanosecond units
                words.append({"w": chunk["text"], "t0": round(start, 3), "t1": round(start + chunk["duration"] / 1e7, 3)})
    return {"id": line["id"], "text": line["text"], "dur": round(duration(path), 3), "words": words}


async def main():
    script = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    timing = []
    for line in script["lines"]:
        info = await record(line, script["voice"], script["rate"], script["pitch"])
        print(f"{info['id']:8s} {info['dur']:5.2f}s  {len(info['words'])} words")
        timing.append(info)
    (OUT / "timing.json").write_text(json.dumps(timing, indent=1), encoding="utf-8")


asyncio.run(main())
