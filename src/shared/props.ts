// Prop catalogue: every object that can appear on a map. Sizes come from the
// real 3D models (see scripts/build-prop-catalog.mjs), scaled per prop.
import models from './models.generated.json';

interface ModelInfo { size: [number, number, number]; center: [number, number, number] }
const MODELS = models as unknown as Record<string, ModelInfo>;

export interface PropType {
  id: string;
  name: string;
  model: string; // path under /models without extension
  scale: number;
  /** Blocks movement. Rugs and other flat things don't. */
  solid: boolean;
  /** Hiders can turn into it. */
  swappable: boolean;
  /** Half extents on the floor (x, z) and full height, after scaling. */
  hx: number;
  hz: number;
  height: number;
  /** Offset that puts the model's bounding box centre on the origin and its base on the floor. */
  offset: [number, number, number];
  /** Movement speed multiplier while disguised as this prop. */
  speed: number;
}

type Def = [id: string, name: string, model: string, scale?: number, flags?: { flat?: boolean; noSwap?: boolean }];

const DEFS: Def[] = [
  ['armchair', 'Armchair', 'furniture/armchair'],
  ['armchair_pillows', 'Comfy armchair', 'furniture/armchair_pillows'],
  ['couch', 'Sofa', 'furniture/couch'],
  ['couch_pillows', 'Comfy sofa', 'furniture/couch_pillows'],
  ['bed_single', 'Single bed', 'furniture/bed_single_A'],
  ['bed_double', 'Double bed', 'furniture/bed_double_A'],
  ['chair_a', 'Chair', 'furniture/chair_A'],
  ['chair_b', 'Blue chair', 'furniture/chair_B'],
  ['chair_c', 'Wooden chair', 'furniture/chair_C'],
  ['stool', 'Stool', 'furniture/chair_stool'],
  ['stool_wood', 'Wooden stool', 'furniture/chair_stool_wood'],
  ['table_small', 'Side table', 'furniture/table_small'],
  ['table_low', 'Coffee table', 'furniture/table_low'],
  ['table_medium', 'Table', 'furniture/table_medium'],
  ['table_long', 'Long table', 'furniture/table_medium_long'],
  ['lamp_standing', 'Floor lamp', 'furniture/lamp_standing'],
  ['lamp_table', 'Table lamp', 'furniture/lamp_table'],
  ['cabinet_small', 'Nightstand', 'furniture/cabinet_small'],
  ['cabinet_medium', 'Dresser', 'furniture/cabinet_medium'],
  ['cabinet_decorated', 'Display cabinet', 'furniture/cabinet_medium_decorated'],
  ['books', 'Books', 'furniture/book_set', 0.9],
  ['cactus_small', 'Small cactus', 'furniture/cactus_small_A'],
  ['cactus_medium', 'Cactus', 'furniture/cactus_medium_A'],
  ['pillow_a', 'Pillow', 'furniture/pillow_A', 1.2],
  ['pillow_b', 'Striped pillow', 'furniture/pillow_B', 1.2],
  ['frame', 'Photo frame', 'furniture/pictureframe_standing_A', 1.2],
  ['rug_rect', 'Rug', 'furniture/rug_rectangle_A', 1, { flat: true }],
  ['rug_stripes', 'Striped rug', 'furniture/rug_rectangle_stripes_A', 1, { flat: true }],
  ['rug_oval', 'Oval rug', 'furniture/rug_oval_A', 1, { flat: true }],
  ['fridge', 'Fridge', 'kitchen/fridge_A', 0.8, { noSwap: true }],
  ['stove', 'Stove', 'kitchen/stove_multi', 0.8, { noSwap: true }],
  ['oven', 'Oven', 'kitchen/oven', 0.8, { noSwap: true }],
  ['counter', 'Counter', 'kitchen/kitchencounter_straight_A', 0.8, { noSwap: true }],
  ['counter_sink', 'Sink', 'kitchen/kitchencounter_sink', 0.8, { noSwap: true }],
  ['crate', 'Crate', 'kitchen/crate', 0.55],
  ['crate_tomatoes', 'Tomato crate', 'kitchen/crate_tomatoes', 0.55],
  ['crate_carrots', 'Carrot crate', 'kitchen/crate_carrots', 0.55],
  ['crate_buns', 'Bun crate', 'kitchen/crate_buns', 0.55],
  ['bowl', 'Bowl', 'kitchen/bowl', 0.5],
  ['plate', 'Plate', 'kitchen/plate', 0.5],
  ['pot', 'Pot', 'kitchen/pot_A', 0.6],
  ['pan', 'Frying pan', 'kitchen/pan_B', 0.6],
  ['burger', 'Burger', 'kitchen/food_burger', 0.5],
  ['dinner', 'Dinner plate', 'kitchen/food_dinner', 0.5],
  ['tomato', 'Tomato', 'kitchen/food_ingredient_tomato', 0.5],
  ['cuttingboard', 'Cutting board', 'kitchen/cuttingboard', 0.6],
  ['dishrack', 'Dish rack', 'kitchen/dishrack', 0.6],
  ['table_round', 'Round table', 'kitchen/table_round_A', 0.8],
  ['kchair_a', 'Kitchen chair', 'kitchen/chair_A'],
  ['kchair_b', 'Red kitchen chair', 'kitchen/chair_B'],
  ['menu', 'Menu board', 'kitchen/menu', 1.2],
];

function speedFor(footprint: number): number {
  if (footprint < 0.6) return 0.6;
  if (footprint < 1.2) return 0.75;
  if (footprint < 2.0) return 0.85;
  return 0.9;
}

export const PROPS: Record<string, PropType> = {};
for (const [id, name, model, scale = 1, flags = {}] of DEFS) {
  const m = MODELS[model];
  if (!m) throw new Error(`Missing model measurements for ${model}; run npm run props`);
  const [sx, sy, sz] = m.size;
  const [cx, cy, cz] = m.center;
  const footprint = Math.max(sx, sz) * scale;
  PROPS[id] = {
    id,
    name,
    model,
    scale,
    solid: !flags.flat,
    swappable: !flags.flat && !flags.noSwap && footprint <= 2.1,
    hx: (sx * scale) / 2,
    hz: (sz * scale) / 2,
    height: sy * scale,
    offset: [-cx * scale, -cy * scale, -cz * scale],
    speed: speedFor(footprint),
  };
}

/** Half extents of a prop on the floor after a rotation in quarter turns. */
export function propExtents(type: PropType, rot: number): [number, number] {
  return rot % 2 === 0 ? [type.hx, type.hz] : [type.hz, type.hx];
}

/** Collision radius of a player disguised as this prop. */
export function disguiseRadius(type: PropType): number {
  return Math.min(Math.max(Math.min(type.hx, type.hz), 0.25), 0.95);
}
