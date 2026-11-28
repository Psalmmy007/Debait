"""High-energy 120 BPM kinetic soundtrack + SFX for Debait 24s promo ad (48 kHz stereo WAV).
Synthesized deterministically with NumPy (no external samples required)."""
import pathlib
import wave
import numpy as np

OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(parents=True, exist_ok=True)

SR = 48000
DUR = 24.0
BPM = 120.0
BEAT = 60.0 / BPM  # 0.500 s
N = int(DUR * SR)
t = np.arange(N, dtype=np.float64) / SR
rng = np.random.default_rng(2026)

L = np.zeros(N, dtype=np.float64)
R = np.zeros(N, dtype=np.float64)

def hz(midi):
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))

def add_slice(at, sig_l, sig_r=None):
    i0 = int(round(at * SR))
    if i0 >= N:
        return
    if sig_r is None:
        sig_r = sig_l
    n = min(len(sig_l), N - i0)
    if i0 < 0:
        off = -i0
        n = min(len(sig_l) - off, N)
        if n <= 0:
            return
        L[0:n] += sig_l[off:off + n]
        R[0:n] += sig_r[off:off + n]
    else:
        L[i0:i0 + n] += sig_l[:n]
        R[i0:i0 + n] += sig_r[:n]

def kick(at, gain=0.85, punch=1.0):
    n = int(0.32 * SR)
    tt = np.arange(n) / SR
    f = 44.0 + 135.0 * punch * np.exp(-tt * 38.0)
    ph = 2.0 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt * 9.5)
    click = np.sin(2.0 * np.pi * 1600.0 * tt) * np.exp(-tt * 160.0) * 0.25
    env = np.clip(tt / 0.002, 0.0, 1.0)
    s = np.tanh((body + click) * 1.45) * env * gain
    add_slice(at, s)

def snare_snap(at, gain=0.45):
    n = int(0.18 * SR)
    tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # Crisp high-pass snap
    hp = noise - np.convolve(noise, np.ones(14) / 14.0, mode="same")
    tone = np.sin(2.0 * np.pi * (190.0 + 90.0 * np.exp(-tt * 40.0)) * tt) * np.exp(-tt * 32.0) * 0.5
    s = (hp * np.exp(-tt * 28.0) * 0.75 + tone) * gain
    add_slice(at, s * 1.03, s * 0.97)

def hat(at, gain=0.18, decay=65.0, pan=0.0):
    n = int(0.08 * SR)
    tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    hp = noise - np.convolve(noise, np.ones(6) / 6.0, mode="same")
    s = hp * np.exp(-tt * decay) * gain
    add_slice(at, s * (1.0 - pan * 0.35), s * (1.0 + pan * 0.35))

def sub_drop(at, f0=95.0, f1=34.0, dur=1.4, gain=0.85):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * 5.2)
    ph = 2.0 * np.pi * np.cumsum(f) / SR
    s = np.tanh(np.sin(ph) * 1.35) * np.exp(-tt / (dur * 0.55)) * np.clip(tt / 0.005, 0.0, 1.0) * gain
    add_slice(at, s)

def bass_note(at, midi, dur=0.44, gain=0.38):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = hz(midi)
    ph = 2.0 * np.pi * f * tt
    # Warm saturated saw/sub blend
    wave_s = np.sin(ph) * 0.7 + np.sin(2.0 * ph) * 0.32 + np.sin(3.0 * ph) * 0.14
    wave_s = np.tanh(wave_s * 1.7)
    env = np.clip(tt / 0.008, 0.0, 1.0) * np.exp(-tt * 3.8)
    s = wave_s * env * gain
    add_slice(at, s)

def pluck(at, midi, dur=0.36, gain=0.20, pan=0.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = hz(midi)
    ph = 2.0 * np.pi * f * tt
    s = (np.sin(ph) + 0.35 * np.sin(2.0 * ph) * np.exp(-tt * 14.0) + 0.15 * np.sin(3.0 * ph) * np.exp(-tt * 22.0))
    s *= np.clip(tt / 0.004, 0.0, 1.0) * np.exp(-tt * 8.5) * gain
    add_slice(at, s * (1.0 - pan * 0.45), s * (1.0 + pan * 0.45))

def riser(start, end, gain=0.32):
    dur = end - start
    n = int(dur * SR)
    tt = np.arange(n) / SR
    p = tt / dur
    noise = rng.standard_normal(n)
    smooth = np.convolve(noise, np.ones(40) / 40.0, mode="same") * 6.0
    sweep = np.sin(2.0 * np.pi * np.cumsum(160.0 + 1400.0 * (p ** 2.6)) / SR) * 0.32
    env = (p ** 2.2) * np.clip((1.0 - p) * 28.0, 0.0, 1.0)
    s = (smooth * 0.65 + sweep) * env * gain
    add_slice(start, s * (0.85 + 0.3 * p), s * (1.15 - 0.3 * p))

def whoosh(at, dur=0.34, gain=0.32):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    noise = rng.standard_normal(n)
    smooth = np.convolve(noise, np.ones(90) / 90.0, mode="same") * 9.0
    env = np.sin(np.linspace(0.0, np.pi, n)) ** 2
    s = smooth * env * gain
    add_slice(at - dur * 0.45, s, s[::-1])

def chord_pad(start, end, midis, gain=0.28):
    dur = end - start
    n = int(dur * SR)
    tt = np.arange(n) / SR
    env = np.clip(tt / 0.35, 0.0, 1.0) * np.clip((dur - tt) / 0.6, 0.0, 1.0)
    pl = np.zeros(n)
    pr = np.zeros(n)
    for i, m in enumerate(midis):
        f = hz(m)
        pl += np.sin(2.0 * np.pi * (f - 0.25) * tt) + 0.18 * np.sin(4.0 * np.pi * f * tt)
        pr += np.sin(2.0 * np.pi * (f + 0.25) * tt) + 0.18 * np.sin(4.0 * np.pi * f * tt)
    pl = (pl / len(midis)) * env * gain
    pr = (pr / len(midis)) * env * gain
    add_slice(start, pl, pr)

# ==================== ARRANGEMENT (120 BPM, 24.0s) ====================

# Scene 1 (0.0 – 3.0s): Crisp minimal kinetic ticks + riser into beat 6 drop
for step in range(12):
    bt = step * 0.25
    hat(bt, gain=0.14 if step % 2 == 0 else 0.08, decay=90.0, pan=(-0.5 if step % 2 == 0 else 0.5))
pluck(0.08, 69, gain=0.18, pan=-0.3)
pluck(0.36, 72, gain=0.18, pan=0.3)
pluck(1.05, 76, gain=0.20, pan=-0.2)
pluck(1.50, 81, dur=0.65, gain=0.26, pan=0.0)
riser(1.90, 3.00, gain=0.38)

# Scene 2 (3.0 – 8.0s): Driving 120 BPM beat + bass + rapid badge snap SFX
sub_drop(3.00, gain=0.90)
bass_seq_2 = [45, 45, 48, 45, 43, 43, 45, 48, 41, 41]
for i in range(10):  # 10 beats = 5.0s
    bt = 3.0 + i * BEAT
    kick(bt, gain=0.88)
    if i % 2 == 1:
        snare_snap(bt, gain=0.42)
    hat(bt + 0.25, gain=0.20, decay=55.0, pan=(0.4 if i % 2 == 0 else -0.4))
    hat(bt + 0.125, gain=0.08, decay=110.0, pan=-0.2)
    bass_note(bt + 0.02, bass_seq_2[i], dur=0.42, gain=0.40)

for snap_t in (4.25, 5.50, 6.75):
    whoosh(snap_t, dur=0.24, gain=0.34)
    pluck(snap_t, 76 if snap_t < 6 else 79, dur=0.25, gain=0.24)
riser(7.25, 8.00, gain=0.30)

# Scene 3 (8.0 – 10.0s): Dark dramatic sweep + suspense sub
sub_drop(8.00, f0=80.0, f1=36.0, dur=1.6, gain=0.82)
whoosh(8.95, dur=1.25, gain=0.32)
chord_pad(8.00, 10.05, [57, 64, 67, 71], gain=0.22)  # Am9 suspense
riser(9.20, 10.00, gain=0.36)

# Scene 4 (10.0 – 17.0s): High-energy product showcase groove + card swooshes
sub_drop(10.00, gain=0.88)
chord_pad(10.00, 13.50, [53, 60, 64, 69], gain=0.20)  # Fmaj7
chord_pad(13.50, 17.00, [55, 62, 67, 71], gain=0.22)  # G6
bass_seq_4 = [41, 41, 45, 41, 43, 43, 47, 43, 45, 45, 48, 45, 43, 47]
arp_4 = [69, 72, 76, 79, 76, 72, 74, 79]
for i in range(14):  # 14 beats = 7.0s
    bt = 10.0 + i * BEAT
    kick(bt, gain=0.86)
    if i % 2 == 1:
        snare_snap(bt, gain=0.44)
    hat(bt + 0.25, gain=0.21, decay=50.0, pan=(0.5 if i % 2 == 0 else -0.5))
    hat(bt + 0.375, gain=0.10, decay=100.0, pan=0.0)
    bass_note(bt + 0.02, bass_seq_4[i], dur=0.42, gain=0.38)
    pluck(bt, arp_4[i % len(arp_4)], dur=0.30, gain=0.16, pan=(-0.4 if i % 2 == 0 else 0.4))
    pluck(bt + 0.25, arp_4[(i + 2) % len(arp_4)], dur=0.22, gain=0.12, pan=(0.4 if i % 2 == 0 else -0.4))

for card_t in (11.75, 13.50, 15.20):
    whoosh(card_t, dur=0.32, gain=0.36)
riser(16.10, 17.00, gain=0.44)

# Scene 5 (17.0 – 21.0s): White flash + rapid word-by-word kinetic slams
sub_drop(17.00, gain=0.92)
for hit_t, midi in [(17.04, 60), (17.42, 64), (17.80, 67), (18.42, 69), (18.88, 72)]:
    kick(hit_t, gain=0.82, punch=1.2)
    snare_snap(hit_t, gain=0.36)
    pluck(hit_t, midi + 12, dur=0.25, gain=0.22)
# Massive "bait." slam at 19.60s + fast tension build into end lockup
sub_drop(19.60, f0=120.0, f1=32.0, dur=1.4, gain=1.0)
snare_snap(19.60, gain=0.58)
riser(20.15, 21.00, gain=0.42)

# Scene 6 (21.0 – 24.0s): Orb reveal sub-hit + warm shimmering resolve
sub_drop(21.00, f0=90.0, f1=36.0, dur=2.2, gain=0.90)
chord_pad(21.00, 24.00, [48, 55, 60, 64, 67, 74], gain=0.34)  # Cmaj9 open resolve
for idx, (st, m) in enumerate([(21.32, 72), (21.92, 76), (22.26, 79), (22.60, 84)]):
    pluck(st, m, dur=1.2, gain=0.20, pan=(idx - 1.5) * 0.28)

# Gentle tail fade-out at 23.65 – 24.00s + soft limiter
fade_out = np.clip((DUR - t) / 0.35, 0.0, 1.0)
L = np.tanh(L * 0.92) * 0.88 * fade_out
R = np.tanh(R * 0.92) * 0.88 * fade_out

pcm = np.stack([L, R], axis=1)
pcm16 = np.clip(pcm * 32767.0, -32767.0, 32767.0).astype("<i2")

wav_path = OUT / "audio.wav"
with wave.open(str(wav_path), "wb") as wf:
    wf.setnchannels(2)
    wf.setsampwidth(2)
    wf.setframerate(SR)
    wf.writeframes(pcm16.tobytes())

print(f"wrote {wav_path} ({DUR:.1f}s, {SR}Hz stereo)")
