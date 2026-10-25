// Tiny synthesized sounds, so the game ships with no audio files.
// Browsers only allow sound after the first tap, so unlock() runs then.

let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, pan = 0, slideTo?: number, delay = 0) {
  if (!ctx || vol <= 0.001) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  osc.connect(gain).connect(panner).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Volume and pan for a sound at distance d, with screen x offset in -1..1. */
export function spatial(d: number, screenX: number) {
  return { vol: Math.max(0, 1 - d / 22) ** 1.5, pan: screenX };
}

export const sfx = {
  pop(vol = 0.25, pan = 0) { tone(520, 0.12, 'sine', vol, pan, 900); },
  swap() { tone(380, 0.1, 'triangle', 0.25, 0, 760); tone(760, 0.12, 'sine', 0.18, 0, 1200, 0.08); },
  tick() { tone(880, 0.05, 'square', 0.06); },
  go() { tone(523, 0.12, 'triangle', 0.25); tone(659, 0.12, 'triangle', 0.25, 0, undefined, 0.12); tone(784, 0.25, 'triangle', 0.25, 0, undefined, 0.24); },
  found() { tone(660, 0.1, 'square', 0.15); tone(990, 0.25, 'square', 0.15, 0, 1320, 0.1); },
  miss() { tone(220, 0.25, 'sawtooth', 0.12, 0, 140); },
  taunt(vol: number, pan: number) {
    tone(700, 0.12, 'sine', vol * 0.5, pan, 1000);
    tone(1000, 0.12, 'sine', vol * 0.5, pan, 700, 0.14);
    tone(700, 0.18, 'sine', vol * 0.5, pan, 1100, 0.28);
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.22, 0, undefined, i * 0.12)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, 0, undefined, i * 0.15)); },
};
