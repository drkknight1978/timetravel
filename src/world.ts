import {
  Block,
  CHUNK,
  DEPTH,
  HEIGHT,
  WIDTH,
  type Delta,
  type Edit,
  type Site,
  type Vec3,
} from "./model";
export class Voxels {
  data = new Uint8Array(WIDTH * HEIGHT * DEPTH);
  dirty = new Set<string>();
  pending: Delta[] = [];
  static index(x: number, y: number, z: number): number {
    return x + WIDTH * (z + DEPTH * y);
  }
  static position(i: number): Vec3 {
    return {
      x: i % WIDTH,
      y: Math.floor(i / (WIDTH * DEPTH)),
      z: Math.floor(i / WIDTH) % DEPTH,
    };
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && x < WIDTH && z >= 0 && z < DEPTH && y >= 0 && y < HEIGHT;
  }
  get(x: number, y: number, z: number): Block {
    return this.inside(x, y, z) ? this.data[Voxels.index(x, y, z)] : Block.Air;
  }
  set(x: number, y: number, z: number, value: Block, record = true): boolean {
    if (!this.inside(x, y, z)) return false;
    const index = Voxels.index(x, y, z),
      before = this.data[index];
    if (before === value) return false;
    this.data[index] = value;
    if (record) this.pending.push({ index, before, after: value });
    this.mark(x, y, z);
    return true;
  }
  apply(d: Delta, forward: boolean): void {
    const p = Voxels.position(d.index);
    this.set(p.x, p.y, p.z, forward ? d.after : d.before, false);
  }
  mark(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of [
      [0, 0, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ]) {
      const a = x + dx,
        b = y + dy,
        c = z + dz;
      if (this.inside(a, b, c))
        this.dirty.add(
          `${Math.floor(a / CHUNK)},${Math.floor(b / CHUNK)},${Math.floor(c / CHUNK)}`,
        );
    }
  }
  markAll(): void {
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 4; z++) this.dirty.add(`${x},${y},${z}`);
  }
  ground(x: number, z: number): number {
    for (let y = HEIGHT - 1; y >= 0; y--)
      if (this.get(Math.floor(x), y, Math.floor(z))) return y + 1;
    return 0;
  }
  restore(data: Uint8Array): void {
    this.data.set(data);
    this.pending = [];
    this.markAll();
  }
}
export const SITES: Site[] = [
  {
    name: "The archway",
    x: 23,
    z: 24,
    cells: [],
    blueprints: [],
    supplies: [],
    patrol: [],
    stands: [
      { x: 20.5, y: 5, z: 25.5 },
      { x: 26.5, y: 5, z: 25.5 },
    ],
  },
  {
    name: "The lookout",
    x: 43,
    z: 30,
    cells: [],
    blueprints: [],
    supplies: [],
    patrol: [],
    stands: [
      { x: 40.5, y: 5, z: 31.5 },
      { x: 46.5, y: 5, z: 31.5 },
    ],
  },
];
for (const [i, site] of SITES.entries()) {
  const cells = (entries: number[][]): Edit[] =>
    entries.map(([dx, dy, dz, block]) => ({
      x: site.x + dx,
      y: 5 + dy,
      z: site.z + dz,
      block,
    }));
  const arch: number[][] = [];
  for (let y = 0; y < 3; y++)
    for (const dx of [-1, 1]) arch.push([dx, y, 0, Block.Wood]);
  for (let dx = -1; dx <= 1; dx++) arch.push([dx, 3, 0, Block.Stone]);
  const gate: number[][] = [];
  for (let y = 0; y < 2; y++)
    for (const dx of [-2, 2]) gate.push([dx, y, 0, Block.Stone]);
  for (let dx = -2; dx <= 2; dx++) gate.push([dx, 2, 0, Block.Wood]);
  for (const dx of [-2, 0, 2]) gate.push([dx, 3, 0, Block.Leaf]);
  const spires: number[][] = [];
  for (let y = 0; y < 4; y++)
    for (const dx of [-2, 0, 2])
      if (y < 4 - Math.abs(dx) / 2)
        spires.push([dx, y, 0, y === 3 ? Block.Leaf : Block.Stone]);
  const steps: number[][] = [];
  for (let y = 0; y < 3; y++)
    for (let dx = -2 + y; dx <= 2 - y; dx++)
      steps.push([dx, y, 0, Block.Stone]);
  steps.push([0, 3, 0, Block.Wood], [0, 4, 0, Block.Leaf]);
  site.blueprints =
    i === 0
      ? [
          { name: "Timber arch", cells: cells(arch) },
          { name: "Garden gate", cells: cells(gate) },
          { name: "Stone spires", cells: cells(spires) },
        ]
      : [
          { name: "Stepped lookout", cells: cells(steps) },
          { name: "Stone spires", cells: cells(spires) },
          { name: "Garden gate", cells: cells(gate) },
        ];
  site.cells = site.blueprints[0].cells;
  site.supplies = [
    { x: site.x - 5.5, y: 5, z: site.z + 7.5 },
    { x: site.x + 5.5, y: 5, z: site.z + 7.5 },
  ];
  site.patrol = [
    { x: site.x + 4.5, y: 5, z: site.z + 4.5 },
    { x: 33.5 + i * 2, y: 5, z: 34.5 },
    { x: site.x - 4.5, y: 5, z: site.z + 4.5 },
    { x: site.x - 4.5, y: 5, z: site.z - 2.5 },
  ];
}
export function blueprintAt(site: number, cycle: number) {
  const variants = SITES[site].blueprints;
  return variants[Math.floor(cycle / 2) % variants.length];
}
export function createLandscape(): Voxels {
  const v = new Voxels();
  for (let x = 0; x < WIDTH; x++)
    for (let z = 0; z < DEPTH; z++) {
      // Broad stepped landforms leave one-block routes up the ridge and down to the pond.
      const ridge = Math.max(0, 1 - Math.hypot((x - 25) / 23, (z - 8) / 13));
      const east = Math.max(0, 1 - Math.hypot((x - 56) / 13, (z - 49) / 21));
      let top =
        4 +
        Math.floor(
          ridge * 7 +
            east * 3 +
            Math.max(0, Math.sin(x * 0.17) + Math.cos(z * 0.15)) * 0.8,
        );
      const pond = Math.hypot((x - 8.5) / 6, (z - 27.5) / 8);
      if (pond < 1.2) top = pond < 0.83 ? 2 : 3;
      if (
        (x > 12 && x < 52 && z > 17 && z < 39) ||
        (z > 36 && z < 43 && x > 7 && x < 56)
      )
        top = 4;
      for (let y = 0; y <= top; y++)
        v.set(
          x,
          y,
          z,
          y === 0
            ? Block.Bedrock
            : y === top
              ? pond < 1.2
                ? Block.Sand
                : ridge > 0.63
                  ? Block.Slate
                  : Block.Grass
              : y > top - 3
                ? Block.Dirt
                : Block.Stone,
          false,
        );
      if (
        (z >= 37 && z <= 39 && x > 9 && x < 55) ||
        (x >= 30 && x <= 32 && z > 8 && z < 55) ||
        (z >= 29 && z <= 30 && x > 9 && x < 20) ||
        (z >= 47 && z <= 48 && x > 18 && x < 49)
      )
        v.set(x, top, z, Block.Path, false);
    }
  for (const site of SITES)
    for (let x = site.x - 4; x <= site.x + 4; x++)
      for (let z = site.z - 3; z <= site.z + 4; z++) {
        for (let y = 5; y < 12; y++) v.set(x, y, z, Block.Air, false);
        v.set(
          x,
          4,
          z,
          Math.abs(x - site.x) === 4 || z === site.z - 3 || z === site.z + 4
            ? Block.Stone
            : Block.Path,
          false,
        );
      }
  for (const [x, z] of [
    [8, 14],
    [14, 8],
    [27, 9],
    [42, 11],
    [54, 18],
    [57, 46],
    [39, 52],
    [20, 54],
    [8, 46],
    [55, 10],
    [60, 26],
    [53, 54],
    [9, 55],
    [44, 58],
    [4, 8],
    [58, 57],
  ]) {
    const y = v.ground(x, z);
    for (let dy = 0; dy < 4; dy++) v.set(x, y + dy, z, Block.Wood, false);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = 3; dy <= 5; dy++)
          if (Math.abs(dx) + Math.abs(dz) + (dy === 5 ? 1 : 0) < 4)
            v.set(x + dx, y + dy, z + dz, Block.Leaf, false);
  }
  // Visible stockpiles anchor supply and salvage journeys. Arrival squares stay clear.
  for (const site of SITES)
    for (const [role, depot] of site.supplies.entries()) {
      const x = Math.floor(depot.x),
        z = Math.floor(depot.z) + 1;
      for (let dx = -1; dx <= 1; dx++) {
        v.set(x + dx, 4, z, Block.Path, false);
        v.set(x + dx, 5, z, role === 0 ? Block.Wood : Block.Stone, false);
      }
      v.set(x, 6, z, role === 0 ? Block.Wood : Block.Stone, false);
    }
  // A few stone markers make the bounds and changing perspective easier to read.
  for (const [x, z] of [
    [12, 39],
    [53, 39],
    [31, 18],
  ])
    for (let y = 5; y < 8; y++) v.set(x, y, z, Block.Stone, false);
  // Broken northern pillars offer readable cover and flank routes in the arena.
  // These are ordinary voxels: dismantling cover and rewinding it changes fights.
  for (const [x, z, height] of [
    [38, 18, 3],
    [40, 13, 2],
    [47, 13, 3],
    [51, 17, 2],
    [47, 22, 2],
  ]) {
    const base = v.ground(x, z);
    for (let dy = 0; dy < height; dy++)
      v.set(x, base + dy, z, Block.Stone, false);
    v.set(x + 1, v.ground(x + 1, z), z, Block.Slate, false);
  }
  // A small camp beside the spawn path; crafted props remain ordinary reversible edits.
  const benchY = v.ground(30, 42);
  v.set(30, benchY, 42, Block.Workbench, false);
  for (const [x, z] of [
    [29, 42],
    [31, 42],
    [30, 41],
    [30, 43],
  ])
    v.set(x, v.ground(x, z) - 1, z, Block.Path, false);
  v.set(32, v.ground(32, 43), 43, Block.Lantern, false);
  v.pending = [];
  v.markAll();
  return v;
}
export interface Hit {
  x: number;
  y: number;
  z: number;
  normal: Vec3;
  block: Block;
}
export function raycast(
  v: Voxels,
  origin: Vec3,
  dir: Vec3,
  max = 5,
): Hit | undefined {
  let x = Math.floor(origin.x),
    y = Math.floor(origin.y),
    z = Math.floor(origin.z);
  const sx = Math.sign(dir.x),
    sy = Math.sign(dir.y),
    sz = Math.sign(dir.z);
  const dx = dir.x === 0 ? Infinity : Math.abs(1 / dir.x),
    dy = dir.y === 0 ? Infinity : Math.abs(1 / dir.y),
    dz = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);
  let tx = dir.x === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - origin.x) / dir.x;
  let ty = dir.y === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - origin.y) / dir.y;
  let tz = dir.z === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - origin.z) / dir.z;
  let distance = 0,
    normal = { x: 0, y: 0, z: 0 };
  while (distance <= max) {
    const block = v.get(x, y, z);
    if (block) return { x, y, z, normal, block };
    if (tx <= ty && tx <= tz) {
      x += sx;
      distance = tx;
      tx += dx;
      normal = { x: -sx, y: 0, z: 0 };
    } else if (ty <= tz) {
      y += sy;
      distance = ty;
      ty += dy;
      normal = { x: 0, y: -sy, z: 0 };
    } else {
      z += sz;
      distance = tz;
      tz += dz;
      normal = { x: 0, y: 0, z: -sz };
    }
  }
  return undefined;
}
