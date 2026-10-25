// Shared movement so the client can predict its own player exactly the way
// the server moves it.
import type { Box } from './map';

export interface Vec { x: number; z: number }

/** Push a circle out of one box. Returns true if it collided. */
function pushOut(p: Vec, r: number, b: Box): boolean {
  const cx = Math.max(b.x - b.hx, Math.min(p.x, b.x + b.hx));
  const cz = Math.max(b.z - b.hz, Math.min(p.z, b.z + b.hz));
  let dx = p.x - cx;
  let dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
    return true;
  }
  // Centre is inside the box: leave by the nearest face.
  const left = p.x - (b.x - b.hx), right = b.x + b.hx - p.x;
  const top = p.z - (b.z - b.hz), bottom = b.z + b.hz - p.z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = b.x - b.hx - r;
  else if (m === right) p.x = b.x + b.hx + r;
  else if (m === top) p.z = b.z - b.hz - r;
  else p.z = b.z + b.hz + r;
  dx = dz = 0;
  return true;
}

/**
 * Move a circle of radius r by (dx, dz) * speed * dt, sliding along boxes.
 * dx/dz is a direction with length at most 1.
 */
export function move(pos: Vec, dx: number, dz: number, speed: number, dt: number, r: number, boxes: Box[], width: number, depth: number): Vec {
  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const p = { x: pos.x + dx * speed * dt, z: pos.z + dz * speed * dt };
  for (let i = 0; i < 3; i++) {
    let hit = false;
    for (const b of boxes) {
      if (Math.abs(p.x - b.x) > b.hx + r || Math.abs(p.z - b.z) > b.hz + r) continue;
      if (pushOut(p, r, b)) hit = true;
    }
    if (!hit) break;
  }
  p.x = Math.max(r, Math.min(width - r, p.x));
  p.z = Math.max(r, Math.min(depth - r, p.z));
  return p;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Distance from a point to the edge of a box (0 when inside). */
export function distToBox(p: Vec, b: Box): number {
  const dx = Math.max(Math.abs(p.x - b.x) - b.hx, 0);
  const dz = Math.max(Math.abs(p.z - b.z) - b.hz, 0);
  return Math.hypot(dx, dz);
}
