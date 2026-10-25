// Map definitions. A map is a floor plan (rooms, walls with door gaps) plus
// placed props. Everything is axis-aligned so collision stays simple.
import { PROPS, propExtents } from './props';

export interface Box { x: number; z: number; hx: number; hz: number }
export interface Room { name: string; x0: number; z0: number; x1: number; z1: number; floor: string }
export interface PlacedProp { id: string; type: string; x: number; z: number; rot: number }
export interface MapDef {
  id: string;
  name: string;
  width: number;
  depth: number;
  wallHeight: number;
  wallColor: string;
  rooms: Room[];
  walls: Box[];
  props: PlacedProp[];
  seekerSpawn: { x: number; z: number };
  hiderSpawns: { x: number; z: number }[];
}

const T = 0.2; // half wall thickness

/** Horizontal wall along z from x0 to x1, with optional door gaps [from, to]. */
function wallX(z: number, x0: number, x1: number, gaps: [number, number][] = []): Box[] {
  const out: Box[] = [];
  let start = x0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > start) out.push({ x: (start + g0) / 2, z, hx: (g0 - start) / 2, hz: T });
    start = g1;
  }
  if (x1 > start) out.push({ x: (start + x1) / 2, z, hx: (x1 - start) / 2, hz: T });
  return out;
}

/** Vertical wall along x from z0 to z1, with optional door gaps. */
function wallZ(x: number, z0: number, z1: number, gaps: [number, number][] = []): Box[] {
  return wallX(0, z0, z1, gaps).map((b) => ({ x, z: b.x, hx: T, hz: b.hx }));
}

type P = [type: string, x: number, z: number, rot?: number];

function place(list: P[]): PlacedProp[] {
  return list.map(([type, x, z, rot = 0], i) => {
    if (!PROPS[type]) throw new Error(`Unknown prop ${type}`);
    return { id: `p${i}`, type, x, z, rot };
  });
}

// Cozy House: 28 x 20. Living room (top left), kitchen (top right),
// bedroom (bottom left), hallway (bottom middle), dining room (bottom right).
const cozyHouse: MapDef = {
  id: 'cozy-house',
  name: 'Cozy House',
  width: 28,
  depth: 20,
  wallHeight: 1.6,
  wallColor: '#f3e6d3',
  rooms: [
    { name: 'Living room', x0: 0, z0: 0, x1: 14, z1: 10, floor: '#d9b38c' },
    { name: 'Kitchen', x0: 14, z0: 0, x1: 28, z1: 10, floor: '#e8e2d6' },
    { name: 'Bedroom', x0: 0, z0: 10, x1: 12, z1: 20, floor: '#c9a7d9' },
    { name: 'Hallway', x0: 12, z0: 10, x1: 20, z1: 20, floor: '#cfc2a8' },
    { name: 'Dining room', x0: 20, z0: 10, x1: 28, z1: 20, floor: '#b9d4b0' },
  ],
  walls: [
    ...wallX(0, 0, 28),
    ...wallX(20, 0, 28),
    ...wallZ(0, 0, 20),
    ...wallZ(28, 0, 20),
    ...wallZ(14, 0, 10, [[4, 6.6]]),
    ...wallX(10, 0, 28, [[5, 7.6], [15, 17.6], [23, 25.6]]),
    ...wallZ(12, 10, 20, [[14, 16.6]]),
    ...wallZ(20, 10, 20, [[14, 16.6]]),
  ],
  seekerSpawn: { x: 16, z: 15 },
  hiderSpawns: [
    { x: 7, z: 7.6 }, { x: 8.6, z: 2.8 }, { x: 23.6, z: 4.8 }, { x: 6, z: 14 },
    { x: 22.4, z: 12.6 }, { x: 4.4, z: 7.4 }, { x: 17, z: 5.4 }, { x: 8, z: 16 },
  ],
  props: place([
    // Living room
    ['rug_stripes', 6.5, 5, 0],
    ['couch_pillows', 6.5, 1.3, 2],
    ['armchair', 3, 5, 1],
    ['armchair', 10, 5, 3],
    ['table_low', 6.5, 5, 0],
    ['lamp_standing', 1, 1, 0],
    ['lamp_standing', 12.8, 1, 0],
    ['table_small', 1, 8.8, 0],
    ['lamp_table', 3, 8.9, 0],
    ['cabinet_decorated', 9.5, 9.2, 2],
    ['books', 6.5, 9.3, 2],
    ['books', 12.5, 8.8, 1],
    ['cactus_medium', 13.2, 3.2, 0],
    ['cactus_small', 4.2, 1, 0],
    ['cactus_small', 11.6, 3, 0],
    ['pillow_a', 2.2, 2.4, 0],
    ['pillow_b', 11.5, 7.2, 1],
    ['frame', 8.4, 4.6, 0],
    ['stool', 13, 6.8, 0],
    ['chair_a', 1, 6.5, 1],
    // Kitchen
    ['counter', 15.4, 1.2, 2],
    ['counter_sink', 17, 1.2, 2],
    ['counter', 18.6, 1.2, 2],
    ['stove', 20.2, 1.2, 2],
    ['counter', 21.8, 1.2, 2],
    ['oven', 23.4, 1.2, 2],
    ['fridge', 26.8, 1.2, 2],
    ['table_medium', 20, 5.6, 0],
    ['kchair_a', 18.6, 5.6, 1],
    ['kchair_a', 21.4, 5.6, 3],
    ['kchair_b', 20, 4.2, 0],
    ['kchair_b', 20, 7, 2],
    ['crate_tomatoes', 26.6, 4, 0],
    ['crate_carrots', 26.6, 5.4, 0],
    ['crate_tomatoes', 26.6, 6.8, 0],
    ['crate_carrots', 25.2, 8.8, 0],
    ['pot', 15.4, 3, 0],
    ['pan', 16.8, 3, 1],
    ['bowl', 24, 3, 0],
    ['plate', 15.2, 8.8, 0],
    ['plate', 16.2, 9, 0],
    ['burger', 23.2, 6.6, 0],
    ['bowl', 17, 7.2, 0],
    ['tomato', 25.2, 6.6, 0],
    ['tomato', 24.6, 4.4, 0],
    ['pan', 22.6, 3, 0],
    ['pot', 18.4, 3, 0],
    ['menu', 27.4, 9.2, 3],
    // Bedroom
    ['rug_oval', 6, 15, 0],
    ['bed_double', 2.2, 15, 1],
    ['cabinet_small', 1, 12.2, 0],
    ['cabinet_small', 1, 17.8, 0],
    ['lamp_table', 1, 11.2, 0],
    ['cabinet_medium', 8, 19.2, 2],
    ['pillow_a', 5.4, 11.4, 0],
    ['pillow_b', 6.4, 18.4, 2],
    ['pillow_a', 10.6, 13, 1],
    ['books', 10.8, 18.6, 3],
    ['lamp_standing', 11, 11, 0],
    ['chair_a', 9.8, 16, 3],
    ['frame', 4, 19.4, 2],
    ['cactus_small', 7.4, 11, 0],
    // Hallway
    ['rug_rect', 16, 15, 1],
    ['table_small', 13, 19, 0],
    ['lamp_table', 19, 19, 0],
    ['cactus_medium', 13, 11, 0],
    ['stool_wood', 19, 11.2, 0],
    ['books', 16, 19.4, 2],
    // Dining room
    ['table_round', 24, 15, 0],
    ['chair_b', 24, 12.6, 0],
    ['chair_b', 24, 17.4, 2],
    ['chair_a', 21.6, 15, 1],
    ['chair_a', 26.4, 15, 3],
    ['cabinet_decorated', 24, 19.2, 2],
    ['lamp_standing', 27, 11, 0],
    ['lamp_standing', 21, 19, 0],
    ['stool', 27, 19, 0],
    ['stool_wood', 21, 11, 0],
    ['plate', 25.6, 11.2, 0],
    ['cactus_small', 27.2, 13, 0],
    ['pillow_b', 21, 17.4, 0],
    ['burger', 26.6, 17.8, 0],
  ]),
};

export const MAPS: Record<string, MapDef> = { [cozyHouse.id]: cozyHouse };

/** Every axis-aligned box that blocks movement on a map: walls plus solid props. */
export function staticColliders(map: MapDef): Box[] {
  const out = [...map.walls];
  for (const p of map.props) {
    const t = PROPS[p.type];
    if (!t.solid) continue;
    const [hx, hz] = propExtents(t, p.rot);
    out.push({ x: p.x, z: p.z, hx, hz });
  }
  return out;
}
