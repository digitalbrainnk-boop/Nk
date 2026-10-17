// Mode démo (sans clé Kie) : petite maquette instrumentale synthétisée en WAV,
// pour tester tout le parcours (lecteur, karaoké, téléchargement, partage).

const RATE = 22050;

const CHORDS = [
  [261.63, 329.63, 392.0], // Do
  [196.0, 246.94, 293.66], // Sol
  [220.0, 261.63, 329.63], // La mineur
  [174.61, 220.0, 261.63], // Fa
];
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0];

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function addTone(buf: Float32Array, start: number, dur: number, freq: number, gain: number, attack: number, decay: number, shape: "sine" | "tri" = "sine") {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    const ph = 2 * Math.PI * freq * t;
    const v = shape === "sine" ? Math.sin(ph) : (2 / Math.PI) * Math.asin(Math.sin(ph));
    buf[s0 + i] += v * env * gain;
  }
}

function addKick(buf: Float32Array, start: number, gain: number) {
  const s0 = Math.floor(start * RATE);
  for (let i = 0; i < RATE * 0.25 && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const f = 50 + 90 * Math.exp(-t * 30);
    buf[s0 + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * gain;
  }
}

function addNoise(buf: Float32Array, start: number, dur: number, gain: number, rnd: () => number) {
  const s0 = Math.floor(start * RATE);
  let prev = 0;
  for (let i = 0; i < dur * RATE && s0 + i < buf.length; i++) {
    const white = rnd() * 2 - 1;
    const hp = white - prev; // passe-haut grossier : son de charleston / shaker
    prev = white;
    buf[s0 + i] += hp * Math.exp(-(i / RATE) * 40) * gain;
  }
}

function toWav(samples: Float32Array): Uint8Array {
  const data = samples.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.tanh(samples[i]) * 32000), true);
  return out;
}

/** Variante A rythmée (108 BPM, batterie) ou B acoustique (76 BPM, nappes et arpèges). */
export function synthDemoSong(opts: { variant: "A" | "B"; seconds: number; seed: number }): Uint8Array {
  const { variant, seconds } = opts;
  const rnd = prng(opts.seed + (variant === "A" ? 1 : 2));
  const buf = new Float32Array(Math.floor(seconds * RATE));
  const bpm = variant === "A" ? 108 : 76;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const motif = Array.from({ length: 16 }, () => (rnd() < 0.78 ? PENTA[Math.floor(rnd() * PENTA.length)] : 0));

  for (let b = 0; b * bar < seconds; b++) {
    const t0 = b * bar;
    const chord = CHORDS[b % 4];
    if (variant === "A") {
      for (let k = 0; k < 4; k++) {
        addKick(buf, t0 + k * beat, 0.55);
        addNoise(buf, t0 + k * beat + beat / 2, 0.08, 0.18, rnd);
        addTone(buf, t0 + k * beat, beat * 0.9, chord[0] / 2, 0.28, 0.005, 0.18, "tri");
        chord.forEach((f) => addTone(buf, t0 + k * beat + beat / 2, beat * 0.4, f, 0.07, 0.01, 0.12, "tri"));
      }
      if (b >= 2) motif.slice((b % 2) * 8, (b % 2) * 8 + 8).forEach((f, i) => f && addTone(buf, t0 + (i * beat) / 2, beat / 2, f, 0.12, 0.01, 0.2));
    } else {
      chord.forEach((f) => addTone(buf, t0, bar * 1.05, f / 2, 0.08, 0.6, 3));
      for (let i = 0; i < 8; i++) addTone(buf, t0 + (i * beat) / 2, beat, chord[i % 3], 0.1, 0.005, 0.5);
      if (b >= 1) motif.slice((b % 2) * 8, (b % 2) * 8 + 4).forEach((f, i) => f && addTone(buf, t0 + i * beat, beat * 1.2, f / 2, 0.11, 0.05, 0.8));
      for (let k = 0; k < 8; k++) addNoise(buf, t0 + (k * beat) / 2, 0.05, 0.04, rnd);
    }
  }

  const fadeIn = RATE * 0.4;
  const fadeOut = RATE * 2;
  for (let i = 0; i < buf.length; i++) {
    const g = Math.min(1, i / fadeIn, (buf.length - i) / fadeOut);
    buf[i] *= g * 0.9;
  }
  return toWav(buf);
}
