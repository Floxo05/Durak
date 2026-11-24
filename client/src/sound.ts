let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('durak.muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('durak.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function ac() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.15) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

function noise(dur: number, freq: number, vol = 0.25) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

export type Sfx = 'card' | 'turn' | 'tick' | 'bito' | 'pickup' | 'transfer' | 'durak' | 'win' | 'error' | 'pop';

export function play(s: Sfx) {
  if (muted) return;
  switch (s) {
    case 'card':
      noise(0.09, 2400, 0.35);
      break;
    case 'turn':
      tone(660, 0, 0.18, 'triangle');
      tone(990, 0.12, 0.25, 'triangle');
      break;
    case 'tick':
      tone(1500, 0, 0.04, 'square', 0.05);
      break;
    case 'bito':
      noise(0.35, 900, 0.3);
      tone(523, 0.05, 0.15, 'triangle', 0.08);
      tone(784, 0.15, 0.2, 'triangle', 0.08);
      break;
    case 'pickup':
      for (let i = 0; i < 4; i++) setTimeout(() => noise(0.06, 1800, 0.25), i * 60);
      break;
    case 'transfer':
      tone(440, 0, 0.12, 'sawtooth', 0.06);
      tone(660, 0.08, 0.12, 'sawtooth', 0.06);
      tone(880, 0.16, 0.18, 'sawtooth', 0.06);
      break;
    case 'durak':
      [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.35, i === 3 ? 0.9 : 0.32, 'sawtooth', 0.09));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.1));
      break;
    case 'error':
      tone(140, 0, 0.18, 'square', 0.06);
      break;
    case 'pop':
      tone(880, 0, 0.08, 'sine', 0.1);
      break;
  }
}
