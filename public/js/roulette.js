/**
 * roulette.js — the canvas rotor.
 * Owns geometry, the trapezoidal-velocity spin animation, segment
 * hit-detection and rendering. Knows nothing about the DOM outside its canvas.
 */

const TAU = Math.PI * 2;
/** Pointer sits at 12 o'clock in screen space. */
const POINTER_ANGLE = -Math.PI / 2;

/** Cohesive segment palette — indigo/slate/cyan family only (green is reserved). */
const SEGMENT_FILLS = ['#161c2a', '#1b2333', '#141a26', '#1d2536', '#171e2c', '#202a3d'];
const SEGMENT_ACCENTS = ['#6366f1', '#38bdf8', '#818cf8', '#22d3ee', '#4f46e5', '#0ea5e9'];

const mod = (value, m) => ((value % m) + m) % m;

/**
 * Crypto-backed uniform integer in [0, count).
 * @param {number} count
 */
function randomIndex(count) {
  if (count <= 1) return 0;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return Math.floor((buffer[0] / 4294967296) * count);
}

/**
 * Normalized trapezoidal velocity profile: accelerate -> cruise -> decelerate.
 * Integral is normalized to 1, so `ease(1) === 1` and `ease(0) === 0`.
 * @param {number} t progress 0..1
 * @param {number} accelFrac portion of time spent accelerating
 * @param {number} decelFrac portion of time spent decelerating
 */
function spinEase(t, accelFrac = 0.26, decelFrac = 0.52) {
  const a = accelFrac;
  const d = decelFrac;
  const c = Math.max(0, 1 - a - d);
  const areaA = a / 2;
  const areaC = c;
  const areaD = d / 2;
  const total = (areaA + areaC + areaD) || 1;

  let traveled;
  if (t < a) {
    traveled = (t * t) / (2 * a);
  } else if (t < a + c) {
    traveled = areaA + (t - a);
  } else {
    const u = Math.min(1, (t - a - c) / d);
    traveled = areaA + areaC + d * (u - (u * u) / 2);
  }
  return traveled / total;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class IdeaRoulette {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onTick?: () => void, onSpinStart?: () => void, onSpinEnd?: (idea: object, index: number) => void}} [hooks]
   */
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;

    /** @type {Array<{id:number,title:string,category?:string,difficulty?:string}>} */
    this.segments = [];
    this.rotation = 0;
    this.highlightIndex = null;

    this.size = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.spinning = false;
    this.animation = null;
    this._frame = null;

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();
  }

  /* ---------------------------------------------------------- data */

  /** Rebuilds the wheel from the current available-idea list. */
  setSegments(ideas) {
    this.segments = ideas.slice();
    this.highlightIndex = null;
    this.draw();
  }

  setHighlight(index) {
    this.highlightIndex = index;
    this.#requestFrame();
  }

  clearHighlight() {
    this.highlightIndex = null;
    this.#requestFrame();
  }

  /* ------------------------------------------------------ geometry */

  resize() {
    const wrapper = this.canvas.parentElement;
    const rect = wrapper ? wrapper.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const cssSize = Math.max(200, Math.floor(Math.min(rect.width, rect.height) || rect.width || 480));

    this.size = cssSize;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(cssSize * this.dpr);
    this.canvas.height = Math.floor(cssSize * this.dpr);
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.draw();
  }

  /** Index of the segment currently under the pointer. */
  get pointerIndex() {
    const count = this.segments.length;
    if (!count) return -1;
    const segment = TAU / count;
    const local = mod(POINTER_ANGLE - this.rotation, TAU);
    return Math.min(count - 1, Math.floor(local / segment));
  }

  /** Rotation value that parks segment `index` dead-centre under the pointer. */
  #rotationForIndex(index) {
    const count = this.segments.length;
    const segment = TAU / count;
    const desiredLocal = index * segment + segment / 2;
    return POINTER_ANGLE - desiredLocal;
  }

  /* ---------------------------------------------------------- spin */

  /**
   * Spins the wheel and resolves with the winning segment.
   * @param {number} [forcedIndex] used by tests/demos; omit for crypto-random
   * @returns {Promise<{idea: object, index: number}>}
   */
  spin(forcedIndex) {
    if (this.spinning) return Promise.resolve(null);
    const count = this.segments.length;
    if (!count) return Promise.resolve(null);

    const index = typeof forcedIndex === 'number' ? forcedIndex : randomIndex(count);

    this.spinning = true;
    this.highlightIndex = null;
    this.hooks.onSpinStart?.();

    const start = this.rotation;
    const extraTurns = 5 + Math.floor(Math.random() * 3);
    const target = start + extraTurns * TAU + mod(this.#rotationForIndex(index) - start, TAU);
    const duration = clamp(3400 + count * 90, 3400, 5400) + Math.random() * 500;
    const startedAt = performance.now();

    let lastIndex = this.pointerIndex;

    return new Promise((resolve) => {
      const step = (now) => {
        const progress = clamp((now - startedAt) / duration, 0, 1);
        this.rotation = start + (target - start) * spinEase(progress);

        // Mechanical tick whenever the pointer crosses into a new segment.
        const current = this.pointerIndex;
        if (current !== lastIndex) {
          lastIndex = current;
          this.hooks.onTick?.();
        }

        this.draw();

        if (progress < 1) {
          this.animation = requestAnimationFrame(step);
          return;
        }

        // Snap exactly onto the winning centre, then run a subtle settle wobble.
        this.rotation = target;
        this.#settle(target, index, resolve);
      };

      this.animation = requestAnimationFrame(step);
    });
  }

  /** Damped oscillation so the needle "bites" into the winning segment. */
  #settle(target, index, resolve) {
    const startedAt = performance.now();
    const amplitude = 0.014;
    const duration = 460;

    const step = (now) => {
      const elapsed = now - startedAt;
      const progress = clamp(elapsed / duration, 0, 1);
      const decay = Math.exp(-elapsed / 130);
      this.rotation = target + amplitude * decay * Math.sin((elapsed / 42) * Math.PI);

      this.draw();

      if (progress < 1) {
        this.animation = requestAnimationFrame(step);
        return;
      }

      this.rotation = target;
      this.spinning = false;
      this.highlightIndex = index;
      this.draw();
      this.hooks.onSpinEnd?.(this.segments[index], index);
      resolve({ idea: this.segments[index], index });
    };

    this.animation = requestAnimationFrame(step);
  }

  cancel() {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = null;
    this.spinning = false;
  }

  /* ------------------------------------------------------- drawing */

  #requestFrame() {
    if (this._frame || !this.size) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.draw();
    });
  }

  draw() {
    const ctx = this.ctx;
    const size = this.size;
    if (!ctx || !size) return;

    const center = size / 2;
    const outer = center * 0.955;
    const inner = center * 0.45;
    const count = this.segments.length;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    /* --- outer rim --- */
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, outer, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, outer - 5, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    /* --- rotating rim ticks --- */
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(this.rotation);
    const tickCount = Math.max(48, count * 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i < tickCount; i += 1) {
      const angle = (i / tickCount) * TAU;
      const isMajor = i % 6 === 0;
      const length = isMajor ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (outer - 6), Math.sin(angle) * (outer - 6));
      ctx.lineTo(Math.cos(angle) * (outer - 6 - length), Math.sin(angle) * (outer - 6 - length));
      ctx.globalAlpha = isMajor ? 1 : 0.5;
      ctx.stroke();
    }
    ctx.restore();

    if (!count) {
      this.#drawEmptyRotor(center, inner, outer);
      return;
    }

    /* --- segments --- */
    const segment = TAU / count;

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(this.rotation);

    for (let i = 0; i < count; i += 1) {
      const start = i * segment;
      const end = start + segment;
      const accent = SEGMENT_ACCENTS[i % SEGMENT_ACCENTS.length];

      ctx.beginPath();
      ctx.arc(0, 0, outer - 4, start, end);
      ctx.arc(0, 0, inner, end, start, true);
      ctx.closePath();

      ctx.fillStyle = SEGMENT_FILLS[i % SEGMENT_FILLS.length];
      ctx.fill();

      // Accent edge along one side keeps segments readable without casino stripes.
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Separator
      ctx.beginPath();
      ctx.moveTo(Math.cos(start) * inner, Math.sin(start) * inner);
      ctx.lineTo(Math.cos(start) * (outer - 4), Math.sin(start) * (outer - 4));
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }

    /* --- winner highlight --- */
    if (this.highlightIndex !== null && this.highlightIndex < count) {
      const start = this.highlightIndex * segment;
      const end = start + segment;
      const accent = SEGMENT_ACCENTS[this.highlightIndex % SEGMENT_ACCENTS.length];

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, outer - 4, start, end);
      ctx.arc(0, 0, inner, end, start, true);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.restore();
    }

    /* --- labels --- */
    const fontSize = clamp(outer * 0.052, 9, 15);
    ctx.font = `500 ${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
    ctx.textBaseline = 'middle';

    const available = outer - inner - 26;
    const maxChars = Math.max(6, Math.floor(available / (fontSize * 0.58)));

    for (let i = 0; i < count; i += 1) {
      const middle = i * segment + segment / 2;
      const flip = Math.cos(middle) < 0;
      const text = this.#truncate(this.segments[i].title, maxChars);
      const radius = outer - 14;

      ctx.save();
      ctx.rotate(middle);
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.fillStyle = this.highlightIndex === i ? '#ffffff' : 'rgba(226,232,240,0.82)';

      if (flip) {
        ctx.rotate(Math.PI);
        ctx.fillText(text, -(radius) + 1, 0);
      } else {
        ctx.fillText(text, radius - 1, 0);
      }
      ctx.restore();
    }

    ctx.restore();

    /* --- inner hub plate --- */
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, inner, 0, TAU);
    ctx.fillStyle = '#0b0e15';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  #drawEmptyRotor(center, inner, outer) {
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, (inner + outer - 4) / 2, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, inner, 0, TAU);
    ctx.fillStyle = '#0b0e15';
    ctx.fill();
    ctx.restore();
  }

  #truncate(text, maxChars) {
    const value = (text || '').toString();
    return value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : value;
  }

  destroy() {
    this.cancel();
    this._resizeObserver.disconnect();
  }
}