/**
 * A set of independent springs (one per key, e.g. "n3.x", "n3.y", "zoom") stepped together on one
 * requestAnimationFrame loop.
 *
 *  - Retargeting a spring that is still moving keeps its position AND velocity, so interrupting an
 *    animation never produces a jump or a "brick wall" reversal.
 *  - Each axis is its own spring (no 2D distance spring), so X and Y never desync.
 *  - response (seconds) and damping (1 = critically damped, no overshoot) follow Apple's model; the
 *    Clear Street system asks for no bounce, so the app uses damping 1.
 *  - With prefers-reduced-motion the value jumps straight to its target.
 */
export interface SpringConfig {
  response: number;
  damping: number;
}

interface Axis { x: number; v: number; target: number }

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class SpringSet {
  private axes = new Map<string, Axis>();
  private raf = 0;
  private last = 0;

  constructor(
    private readonly cfg: SpringConfig,
    private readonly onFrame: (values: Record<string, number>) => void,
    /** how close to the target counts as arrived, per key prefix; default suits pixels */
    private readonly epsilonFor: (key: string) => number = (k) => (k === 'zoom' ? 0.0008 : 0.05),
  ) {}

  /** Move keys toward new targets. Unknown keys start from `current` (or the target itself). */
  retarget(targets: Record<string, number>, current: Record<string, number> = {}) {
    if (reduced()) {
      this.jump(targets);
      return;
    }
    for (const [k, t] of Object.entries(targets)) {
      const a = this.axes.get(k);
      if (a) a.target = t;
      else this.axes.set(k, { x: current[k] ?? t, v: 0, target: t });
    }
    this.start();
  }

  /** Set values immediately and drop any motion for them (used while the user is dragging). */
  jump(values: Record<string, number>) {
    for (const [k, x] of Object.entries(values)) this.axes.set(k, { x, v: 0, target: x });
    this.onFrame(values);
  }

  cancel(keys: string[]) {
    keys.forEach((k) => this.axes.delete(k));
  }

  cancelWhere(pred: (key: string) => boolean) {
    for (const k of [...this.axes.keys()]) if (pred(k)) this.axes.delete(k);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.axes.clear();
  }

  private start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { response, damping } = this.cfg;
    const k = (2 * Math.PI / response) ** 2; // stiffness
    const c = (4 * Math.PI * damping) / response; // damping coefficient
    const out: Record<string, number> = {};
    let moving = false;
    // semi-implicit Euler in small sub-steps so a slow frame cannot make it unstable
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (const [key, a] of this.axes) {
      for (let i = 0; i < steps; i++) {
        a.v += (-k * (a.x - a.target) - c * a.v) * h;
        a.x += a.v * h;
      }
      const eps = this.epsilonFor(key);
      if (Math.abs(a.x - a.target) < eps && Math.abs(a.v) < eps * 4) {
        a.x = a.target;
        a.v = 0;
      } else moving = true;
      out[key] = a.x;
    }
    this.onFrame(out);
    for (const [key, a] of this.axes) if (a.x === a.target && a.v === 0) this.axes.delete(key);
    this.raf = moving ? requestAnimationFrame(this.tick) : 0;
  };
}
