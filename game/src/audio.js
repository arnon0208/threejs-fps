// Synthesized sound effects on WebAudio. No audio files, no network: every sound
// is an oscillator or filtered noise burst built at runtime. The context is created
// lazily on the first user gesture (pointer lock) so autoplay rules never block it.
let ctx = null;
let master = null;
let enabled = true;

export function initAudio() {
  if (ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function noiseBuffer(duration) {
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ freq = 1200, dur = 0.12, type = 'lowpass', gain = 0.5, slide = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (slide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone({ freq = 440, dur = 0.1, type = 'sine', gain = 0.2, slide = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// distance in metres: beyond 30 m a shot is a dull crack, nearer it is a bang.
export const sfx = {
  shot(kind, dist = 0) {
    const near = dist < 25;
    if (kind === 'rifle') burst({ freq: near ? 900 : 500, dur: 0.14, gain: near ? 0.55 : 0.25, slide: -600 });
    else if (kind === 'smg') burst({ freq: near ? 1400 : 700, dur: 0.08, gain: near ? 0.4 : 0.18, slide: -800 });
    else burst({ freq: near ? 1100 : 600, dur: 0.1, gain: near ? 0.45 : 0.2, slide: -500 });
    if (near) tone({ freq: 180, dur: 0.08, type: 'square', gain: 0.12, slide: -120 });
  },
  dryFire() {
    tone({ freq: 1400, dur: 0.03, type: 'square', gain: 0.08 });
  },
  reload() {
    tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.08 });
    setTimeout(() => tone({ freq: 600, dur: 0.05, type: 'square', gain: 0.1 }), 180);
    setTimeout(() => tone({ freq: 1100, dur: 0.04, type: 'square', gain: 0.08 }), 420);
  },
  hit() {
    tone({ freq: 1900, dur: 0.05, type: 'sine', gain: 0.18 });
  },
  kill() {
    tone({ freq: 660, dur: 0.09, type: 'sine', gain: 0.2 });
    setTimeout(() => tone({ freq: 990, dur: 0.12, type: 'sine', gain: 0.2 }), 90);
  },
  hurt() {
    tone({ freq: 120, dur: 0.18, type: 'sawtooth', gain: 0.25, slide: -60 });
  },
  step() {
    burst({ freq: 300, dur: 0.05, gain: 0.06 });
  },
  plant() {
    tone({ freq: 880, dur: 0.07, type: 'square', gain: 0.12 });
  },
  beep() {
    tone({ freq: 1200, dur: 0.06, type: 'square', gain: 0.1 });
  },
  explosion() {
    burst({ freq: 400, dur: 0.9, gain: 0.8, slide: -320 });
    tone({ freq: 55, dur: 0.8, type: 'sine', gain: 0.5, slide: -25 });
  },
  throwPin() {
    tone({ freq: 2000, dur: 0.03, type: 'square', gain: 0.08 });
  },
  roundWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.16 }), i * 110));
  },
  roundLose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.18, gain: 0.16 }), i * 120));
  },
  buy() {
    tone({ freq: 1320, dur: 0.06, type: 'sine', gain: 0.14 });
    setTimeout(() => tone({ freq: 1760, dur: 0.08, type: 'sine', gain: 0.14 }), 70);
  },
  denied() {
    tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.12 });
  },
};

export function setAudioEnabled(v) {
  enabled = v;
}
