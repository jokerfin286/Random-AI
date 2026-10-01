/**
 * sfx.js — procedural UI audio built on the Web Audio API.
 * No audio assets required; every sound is synthesized on the fly.
 */
export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  /** Lazily creates/resumes the AudioContext (browsers require a user gesture). */
  #context() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.ctx) this.ctx.suspend();
  }

  /** Short mechanical blip for each segment the pointer crosses. */
  tick(strength = 1) {
    const ctx = this.#context();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1250 + Math.random() * 220, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035 * strength, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /** Rising sweep used when a spin launches. */
  whoosh(duration = 0.85) {
    const ctx = this.#context();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /** Two-note confirmation chime for a landed idea. */
  chime() {
    const ctx = this.#context();
    if (!ctx) return;

    [523.25, 783.99].forEach((frequency, index) => {
      const now = ctx.currentTime + index * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.55);
    });
  }

  /** Soft descending tone for errors. */
  errorTone() {
    const ctx = this.#context();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.28);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }
}