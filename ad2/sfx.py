"""Sound effects for the ad, synthesized with numpy (no sample files).
Reads ad2/out/events.json (every on-screen moment, written by render.mjs) and writes
ad2/out/sfx.wav (48 kHz stereo), which gets mixed under the voice with the music."""
import json, pathlib, wave
import numpy as np

ROOT = pathlib.Path(__file__).parent
data = json.loads((ROOT / "out" / "events.json").read_text(encoding="utf-8"))
SR = 48000
N = int(data["duration"] * SR) + SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(11)


def t_(n):
    return np.arange(n) / SR


def env(n, attack=0.002, decay=0.1):
    t = t_(n)
    return np.clip(t / max(attack, 1e-4), 0, 1) * np.exp(-t / decay)


def smooth(x, k):
    k = max(1, int(k))
    return np.convolve(x, np.ones(k) / k, mode="same")


def place(at, sig, pan=0.0, gain=1.0):
    """pan -1 (left) .. 1 (right)"""
    i = int(at * SR)
    if i >= N or i + len(sig) <= 0:
        return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt((1 - pan) / 2)
    R[i:i + len(sig)] += sig * np.sqrt((1 + pan) / 2)


def sweep(f0, f1, dur):
    n = int(dur * SR)
    f = np.geomspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(n):
    return rng.standard_normal(n)


# ---------- the sounds ----------
def tick():
    n = int(0.03 * SR)
    click = np.diff(noise(n + 1)) * env(n, 0.0005, 0.003)
    tone = np.sin(2 * np.pi * 2400 * t_(n)) * env(n, 0.0005, 0.008)
    return 0.6 * click + 0.5 * tone


def tap():
    n = int(0.12 * SR)
    t = t_(n)
    return (np.sin(2 * np.pi * 880 * t) + 0.5 * np.sin(2 * np.pi * 1760 * t)) * env(n, 0.001, 0.05)


def pop():
    n = int(0.12 * SR)
    return sweep(280, 1100, 0.12)[:n] * env(n, 0.001, 0.04)


def impact():
    n = int(0.9 * SR)
    sub = sweep(70, 38, 0.9) * env(n, 0.002, 0.35)
    hit = smooth(noise(n), 30) * 6 * env(n, 0.0005, 0.03)
    return np.tanh(1.6 * (sub + hit))


def boom(dur=2.2, f0=60, f1=26, gain=1.0):
    n = int(dur * SR)
    sub = sweep(f0, f1, dur) * env(n, 0.003, dur / 3)
    hit = smooth(noise(n), 18) * 5 * env(n, 0.0005, 0.05)
    air = smooth(noise(n), 6) * env(n, 0.01, 0.6) * 0.5
    return gain * np.tanh(1.8 * (sub + hit + air))


def riser(dur):
    n = int(dur * SR)
    t = t_(n)
    grow = (t / dur) ** 2.2
    hiss = (noise(n) - smooth(noise(n), 40)) * 0.35
    tone = sweep(180, 1400, dur) * 0.25
    return (hiss + tone) * grow


def whoosh(dur=0.7, bright=40):
    n = int(dur * SR)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    return smooth(noise(n), bright) * 7 * shape


def scan(dur):
    n = int(dur * SR)
    t = t_(n)
    tone = sweep(1500, 700, dur) * (0.5 + 0.5 * np.sin(2 * np.pi * 28 * t))
    shape = np.minimum(1, np.minimum(t / 0.08, (dur - t) / 0.2))
    return tone * shape * 0.45


def counter(dur):
    out = np.zeros(int(dur * SR) + SR // 10)
    steps = int(dur / 0.045)
    for k in range(steps):
        i = int(k * 0.045 * SR)
        n = int(0.025 * SR)
        f = 1200 + 900 * k / max(1, steps)
        seg = np.sin(2 * np.pi * f * t_(n)) * env(n, 0.0005, 0.008)
        out[i:i + n] += seg[: len(out) - i]
    return out * 0.7


def ding():
    n = int(1.4 * SR)
    t = t_(n)
    return (np.sin(2 * np.pi * 1760 * t) + 0.6 * np.sin(2 * np.pi * 2637 * t) + 0.3 * np.sin(2 * np.pi * 3520 * t)) * env(n, 0.002, 0.35)


def chime():
    n = int(1.0 * SR)
    t = t_(n)
    return (np.sin(2 * np.pi * 1318 * t) + 0.7 * np.sin(2 * np.pi * 1976 * t)) * env(n, 0.002, 0.25)


def shimmer():
    out = np.zeros(int(1.6 * SR))
    for k in range(7):
        f = 2600 + 2600 * rng.random()
        n = int(0.6 * SR)
        i = int(k * 0.07 * SR)
        seg = np.sin(2 * np.pi * f * t_(n)) * env(n, 0.002, 0.18)
        out[i:i + n] += seg[: len(out) - i]
    return out * 0.5


def click():
    n = int(0.09 * SR)
    out = np.zeros(n)
    for at, g in ((0, 1.0), (0.055, 0.6)):  # press, release
        i = int(at * SR)
        m = int(0.006 * SR)
        out[i:i + m] += np.diff(noise(m + 1)) * env(m, 0.0002, 0.0015) * g
    return out * 1.6


def whomp():
    n = int(1.0 * SR)
    return np.tanh(2 * (sweep(110, 38, 1.0) * env(n, 0.003, 0.3) + smooth(noise(n), 60) * 3 * env(n, 0.001, 0.08)))


def glitch(dur):
    out = np.zeros(int(dur * SR))
    pos = 0.0
    while pos < dur:
        g = 0.018 + 0.03 * rng.random()
        n = int(g * SR)
        i = int(pos * SR)
        f = 300 + 2500 * rng.random()
        sq = np.sign(np.sin(2 * np.pi * f * t_(n)))
        crushed = np.round(noise(n) * 3) / 3
        seg = (0.6 * sq + 0.4 * crushed) * env(n, 0.0005, g / 2)
        if rng.random() < 0.75:
            out[i:i + n] += seg[: len(out) - i]
        pos += g + 0.01 * rng.random()
    shape = np.minimum(1, (dur - t_(len(out))) / 0.25)
    return out * shape * 0.35


SOUNDS = {
    "tick": (lambda e: tick(), 0.35),
    "tap": (lambda e: tap(), 0.3),
    "pop": (lambda e: pop(), 0.45),
    "impact": (lambda e: impact(), 0.75),
    "boom": (lambda e: boom(), 0.95),
    "boom-soft": (lambda e: boom(1.6, 55, 30), 0.55),
    "riser": (lambda e: riser(e["dur"]), 0.5),
    "whoosh": (lambda e: whoosh(0.8, 30), 0.35),
    "swish": (lambda e: whoosh(0.35, 12), 0.25),
    "swoosh": (lambda e: whoosh(0.5, 18), 0.3),
    "slide": (lambda e: whoosh(1.0, 50), 0.35),
    "scan": (lambda e: scan(e["dur"]), 0.2),
    "counter": (lambda e: counter(e["dur"]), 0.22),
    "ding": (lambda e: ding(), 0.2),
    "chime": (lambda e: chime(), 0.18),
    "shimmer": (lambda e: shimmer(), 0.18),
    "click": (lambda e: click(), 0.6),
    "whomp": (lambda e: whomp(), 0.7),
    "glitch": (lambda e: glitch(e["dur"]), 0.3),
    "final": (lambda e: boom(2.4, 48, 24) + np.pad(ding(), (0, int(2.4 * SR) - len(ding()))), 0.7),
}

for i, e in enumerate(data["events"]):
    fn, gain = SOUNDS.get(e["type"], (None, 0))
    if not fn:
        continue
    pan = 0.0 if e["type"] in ("boom", "boom-soft", "impact", "whomp", "final", "riser") else float(np.clip(rng.normal(0, 0.35), -0.7, 0.7))
    if e["type"] in ("whoosh", "slide"):
        pan = -0.4 if i % 2 else 0.4
    place(e["t"], fn(e), pan, gain)


# a short room around everything, so the effects sit in the same space as the music
def room(x, seconds=1.2, mix=0.2, seed=3):
    n = int(seconds * SR)
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-np.arange(n) / SR / (seconds / 6))
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return (1 - mix) * x + mix * wet


L = room(L, seed=3)
R = room(R, seed=4)
peak = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
out = (np.stack([L, R], axis=1) / peak * 0.85 * 32767).astype(np.int16)
with wave.open(str(ROOT / "out" / "sfx.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
print(f"sfx.wav: {len(data['events'])} effects")
