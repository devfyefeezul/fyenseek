// Virtual joystick (touch or mouse) plus WASD / arrow keys. Produces a
// direction in world space, already turned to match the isometric camera.

export class Controls {
  /** Screen-space direction: right is +x, up is +y. Length 0..1. */
  private stick = { x: 0, y: 0 };
  private keys = new Set<string>();
  private pointerId: number | null = null;
  enabled = true;

  constructor(private area: HTMLElement, private base: HTMLElement, private knob: HTMLElement) {
    area.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.moveP(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.reset(); });
  }

  private down(e: PointerEvent) {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.area.setPointerCapture?.(e.pointerId);
    this.moveP(e);
    e.preventDefault();
  }

  private moveP(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    const r = this.base.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const max = r.width / 2;
    let dx = (e.clientX - cx) / max, dy = (e.clientY - cy) / max;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    // Small dead zone so a resting thumb doesn't drift.
    const mag = Math.hypot(dx, dy);
    this.stick = mag < 0.12 ? { x: 0, y: 0 } : { x: dx, y: -dy };
    this.knob.style.transform = `translate(${dx * max * 0.8}px, ${dy * max * 0.8}px)`;
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.reset();
  }

  private reset() {
    this.pointerId = null;
    this.stick = { x: 0, y: 0 };
    this.knob.style.transform = '';
  }

  /** World direction for the isometric camera (camera looks toward -x, -z). */
  direction(): { dx: number; dz: number } {
    if (!this.enabled) return { dx: 0, dz: 0 };
    let sx = this.stick.x, sy = this.stick.y;
    const k = this.keys;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const ky = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    if (kx || ky) {
      const slow = k.has('shift') ? 0.4 : 1;
      const l = Math.hypot(kx, ky);
      sx = (kx / l) * slow; sy = (ky / l) * slow;
    }
    // Screen right = world (1, 0, -1)/sqrt2, screen up = world (-1, 0, -1)/sqrt2.
    const s = Math.SQRT1_2;
    return { dx: (sx - sy) * s, dz: (-sx - sy) * s };
  }
}
