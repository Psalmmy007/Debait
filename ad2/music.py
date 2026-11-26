"""Ambient music bed for the ad, synthesized with numpy (no samples needed).
Reads ad/out/cues.json (written by render.mjs), writes ad/out/music.wav (48 kHz stereo)."""
import json, pathlib, wave
import numpy as np

ROOT = pathlib.Path(__file__).parent
cue = json.loads((ROOT / "out" / "cues.json").read_text(encoding="utf-8"))
SR = 48000
DUR = cue["duration"]
N = int(DUR * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)

# chords follow the story: tense -> warm when the orb appears -> open after the click -> resolve
sections = [
    (0, cue["reveal"], [45, 52, 55, 59, 60], 0.55),          # A minor add9: the problem
    (cue["reveal"], cue["click"], [41, 48, 52, 57, 60], 0.75),  # F maj7: meet Debait
    (cue["click"], cue["label"], [48, 55, 59, 62, 64], 0.9),    # C maj9: calm
    (cue["label"], cue["end"], [41, 48, 53, 57, 64], 0.85),     # F add9
    (cue["end"], DUR, [48, 55, 60, 64, 67], 0.8),               # C: resolve
]
L = np.zeros(N); R = np.zeros(N)
XF = 1.6
for a, b, notes, amp in sections:
    env = np.clip((t - (a - XF / 2)) / XF, 0, 1) * np.clip(((b + XF / 2) - t) / XF, 0, 1)
    env = env * env * (3 - 2 * env)
    for i, m in enumerate(notes):
        f = hz(m)
        trem = 1 + 0.12 * np.sin(2 * np.pi * (0.11 + 0.03 * i) * t + i)
        for det, ch in ((-0.18, L), (0.18, R)):
            ph = 2 * np.pi * (f + det) * t
            tone = np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
            ch += amp * env * trem * tone / len(notes)

def hit(at, f0=55, f1=32, decay=1.4, gain=0.9):
    idx = t >= at
    tt = t[idx] - at
    f = f1 + (f0 - f1) * np.exp(-tt * 6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = gain * np.sin(ph) * np.exp(-tt / decay) * np.clip(tt / 0.01, 0, 1)
    L[idx] += s; R[idx] += s

def shimmer(at, notes=(76, 83, 88), gain=0.18):
    for k, m in enumerate(notes):
        st = at + 0.08 * k
        idx = t >= st
        tt = t[idx] - st
        s = gain * np.sin(2 * np.pi * hz(m) * tt) * np.exp(-tt / 1.8) * np.clip(tt / 0.02, 0, 1)
        L[idx] += s * (1.1 - 0.2 * k); R[idx] += s * (0.9 + 0.2 * k)

def whoosh(at, dur=1.4, gain=0.25):
    n = int(dur * SR); i0 = int(at * SR)
    if i0 + n > N: n = N - i0
    noise = rng.standard_normal(n)
    k = 400
    smooth = np.convolve(noise, np.ones(k) / k, mode="same") * 18  # soft, airy
    env = np.sin(np.linspace(0, np.pi, n)) ** 2
    L[i0:i0 + n] += gain * smooth * env; R[i0:i0 + n] += gain * smooth * env[::-1]

hit(cue["reveal"], gain=0.8)
hit(cue["meet"], f0=70, f1=40, decay=1.0, gain=0.5)
whoosh(cue["click"])
hit(cue["click"], f0=90, f1=45, decay=0.5, gain=0.45)
shimmer(cue["click"] + 0.1)
shimmer(cue["end"], notes=(72, 79, 84), gain=0.14)

# reverb: convolve with a decaying noise tail (FFT)
def reverb(x, seconds=2.6, mix=0.35, seed=1):
    n = int(seconds * SR)
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-np.arange(n) / SR / (seconds / 5))
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return (1 - mix) * x + mix * wet

L = reverb(L, seed=1); R = reverb(R, seed=2)
fade = np.clip(t / 1.5, 0, 1) * np.clip((DUR - t) / 2.5, 0, 1)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
st = (np.stack([L, R], axis=1) / peak * 0.5 * 32767).astype(np.int16)
with wave.open(str(ROOT / "out" / "music.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print(f"music.wav {DUR:.1f}s")
