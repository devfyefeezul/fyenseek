import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, staticColliders, type Box } from '../src/shared/map';
import { PROPS, propExtents } from '../src/shared/props';
import { PLAYER_RADIUS, SWAP_RANGE } from '../src/shared/constants';
import { distToBox } from '../src/shared/movement';

const overlap = (a: Box, b: Box, pad = 0) => Math.abs(a.x - b.x) < a.hx + b.hx - pad && Math.abs(a.z - b.z) < a.hz + b.hz - pad;

for (const map of Object.values(MAPS)) {
  const solid = map.props.filter((p) => PROPS[p.type].solid).map((p) => {
    const [hx, hz] = propExtents(PROPS[p.type], p.rot);
    return { p, box: { x: p.x, z: p.z, hx, hz } };
  });

  test(`${map.id}: props sit inside the map and clear of walls`, () => {
    for (const { p, box } of solid) {
      assert.ok(box.x - box.hx >= 0.2 && box.x + box.hx <= map.width - 0.2, `${p.id} ${p.type} outside x`);
      assert.ok(box.z - box.hz >= 0.2 && box.z + box.hz <= map.depth - 0.2, `${p.id} ${p.type} outside z`);
      for (const w of map.walls) assert.ok(!overlap(box, w, 0.01), `${p.id} ${p.type} at ${p.x},${p.z} hits a wall`);
    }
  });

  test(`${map.id}: solid props don't overlap each other`, () => {
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      assert.ok(!overlap(a.box, b.box, 0.01), `${a.p.type}@${a.p.x},${a.p.z} overlaps ${b.p.type}@${b.p.x},${b.p.z}`);
    }
  });

  test(`${map.id}: every spawn and swappable prop is reachable on foot`, () => {
    const cell = 0.2;
    const cols = Math.ceil(map.width / cell), rows = Math.ceil(map.depth / cell);
    const boxes = staticColliders(map);
    const free = (cx: number, cz: number) => {
      const x = (cx + 0.5) * cell, z = (cz + 0.5) * cell;
      if (x < PLAYER_RADIUS || z < PLAYER_RADIUS || x > map.width - PLAYER_RADIUS || z > map.depth - PLAYER_RADIUS) return false;
      return boxes.every((b) => distToBox({ x, z }, b) >= PLAYER_RADIUS);
    };
    const seen = new Uint8Array(cols * rows);
    const start = [Math.floor(map.seekerSpawn.x / cell), Math.floor(map.seekerSpawn.z / cell)];
    assert.ok(free(start[0], start[1]), 'seeker spawn is blocked');
    const queue = [start];
    seen[start[1] * cols + start[0]] = 1;
    while (queue.length) {
      const [cx, cz] = queue.pop()!;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows || seen[nz * cols + nx] || !free(nx, nz)) continue;
        seen[nz * cols + nx] = 1;
        queue.push([nx, nz]);
      }
    }
    const reach = (x: number, z: number) => seen[Math.floor(z / cell) * cols + Math.floor(x / cell)] === 1;
    for (const s of map.hiderSpawns) assert.ok(reach(s.x, s.z), `hider spawn ${s.x},${s.z} unreachable`);
    for (const { p, box } of solid) {
      if (!PROPS[p.type].swappable) continue;
      let ok = false;
      for (let i = 0; i < cols * rows && !ok; i++) {
        if (!seen[i]) continue;
        const x = ((i % cols) + 0.5) * cell, z = (Math.floor(i / cols) + 0.5) * cell;
        if (distToBox({ x, z }, box) <= SWAP_RANGE - 0.3) ok = true;
      }
      assert.ok(ok, `${p.type} at ${p.x},${p.z} can't be reached to swap`);
    }
  });

  test(`${map.id}: every swappable prop type appears at least twice`, () => {
    const counts = new Map<string, number>();
    for (const p of map.props) if (PROPS[p.type].swappable) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    const lonely = [...counts].filter(([, n]) => n < 2).map(([t]) => t);
    assert.ok(lonely.length <= 8, `too many one-off disguises: ${lonely.join(', ')}`);
  });
}
