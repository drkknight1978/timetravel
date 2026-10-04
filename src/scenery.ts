import * as THREE from "three";
import { Surface } from "./humans";
import { Block, CHUNK } from "./model";
import { Voxels } from "./world";
import type { Simulation } from "./simulation";

export const isProp = (b: Block) => b >= Block.Workbench && b <= Block.Feeder;
const noise = (x: number, z: number) =>
  ((Math.imul(x + 13, 73856093) ^ Math.imul(z + 7, 83492791)) >>> 0) /
  4294967296;
/** Original tiny material atlas: no external texture downloads or dependencies. */
export function terrainAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext("2d")!;
  for (let b = 0; b < 16; b++) {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) {
        let v = 218 + Math.floor(noise(x + b * 31, y) * 37);
        if (b === Block.Wood) v -= Math.sin(x * 2 + y * 0.25) > 0 ? 22 : 0;
        if (b === Block.Planks && (y % 5 === 0 || x === 0)) v -= 65;
        if ((b === Block.Stone || b === Block.Slate) && (x * 3 + y) % 17 === 0)
          v -= 35;
        if (b === Block.Grass && noise(x + 4, y) > 0.87) v -= 38;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(b * 16 + x, y, 1, 1);
      }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}
function flower(
  s: Surface,
  x: number,
  y: number,
  z: number,
  colour: string,
  scale = 1,
) {
  s.add(new THREE.CylinderGeometry(0.012, 0.016, 0.28 * scale, 4), "#577247", [
    x,
    y + 0.14 * scale,
    z,
  ]);
  s.add(
    new THREE.IcosahedronGeometry(0.065 * scale, 0),
    colour,
    [x, y + 0.29 * scale, z],
    [1, 0.65, 1],
  );
  s.add(new THREE.IcosahedronGeometry(0.023 * scale, 0), "#e9c96c", [
    x,
    y + 0.32 * scale,
    z,
  ]);
}
export interface ChunkDecoration {
  group: THREE.Group;
  flames: THREE.Object3D[];
  lamps: { x: number; y: number; z: number; fire: boolean }[];
}
export function decorateChunk(
  v: Voxels,
  cx: number,
  cy: number,
  cz: number,
): ChunkDecoration {
  const group = new THREE.Group(),
    s = new Surface(),
    flames: THREE.Object3D[] = [],
    lamps: ChunkDecoration["lamps"] = [],
    waterPositions: number[] = [];
  let any = false;
  for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++)
    for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) {
      const top = v.ground(x, z),
        surface = v.get(x, top - 1, z),
        r = noise(x, z);
      if (
        Math.floor((top - 1) / CHUNK) === cy &&
        surface === Block.Grass &&
        r > 0.47
      ) {
        // Keep sites and paths legible; the southern meadow carries more wildflowers.
        const meadow = z > 42,
          px = x + 0.2 + r * 0.6,
          pz = z + 0.25 + noise(z, x) * 0.5;
        if (meadow && r > 0.72)
          flower(
            s,
            px,
            top,
            pz,
            ["#e4c594", "#c292be", "#e6ddd0", "#b5cce0"][
              Math.floor(r * 43) % 4
            ],
            0.8 + r * 0.5,
          );
        else
          for (let i = 0; i < 3; i++)
            s.add(
              new THREE.ConeGeometry(0.035, 0.19 + i * 0.04, 3),
              r > 0.8 ? "#859358" : "#637f4c",
              [px + (i - 1) * 0.08, top + 0.1, pz],
              [1, 1, 1],
              [0.15 * i, 0, 0.2 - i * 0.2],
            );
        any = true;
      }
      if (
        cy === 0 &&
        Math.hypot((x - 8.5) / 6, (z - 27.5) / 8) < 0.83 &&
        v.get(x, 2, z) === Block.Sand &&
        !v.get(x, 3, z)
      ) {
        waterPositions.push(
          x,
          3.14,
          z,
          x,
          3.14,
          z + 1,
          x + 1,
          3.14,
          z,
          x + 1,
          3.14,
          z,
          x,
          3.14,
          z + 1,
          x + 1,
          3.14,
          z + 1,
        );
      }
      for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
        const b = v.get(x, y, z);
        if (!isProp(b)) continue;
        any = true;
        const px = x + 0.5,
          pz = z + 0.5;
        if (b === Block.Workbench) {
          s.box("#976b48", px, y + 0.82, pz, 0.96, 0.17, 0.86);
          for (const dx of [-0.34, 0.34])
            for (const dz of [-0.3, 0.3])
              s.box("#65513b", px + dx, y + 0.4, pz + dz, 0.14, 0.8, 0.14);
          s.box("#beaa77", px - 0.18, y + 0.93, pz, 0.23, 0.08, 0.35);
          s.box("#53675e", px + 0.22, y + 0.93, pz, 0.17, 0.06, 0.27);
        }
        if (b === Block.Lantern) {
          lamps.push({ x: px, y: y + 0.8, z: pz, fire: false });
          s.box("#74644a", px, y + 0.16, pz, 0.55, 0.32, 0.55);
          s.box("#514b3d", px, y + 0.45, pz, 0.075, 0.6, 0.075);
          s.box("#514b3d", px, y + 0.57, pz, 0.32, 0.055, 0.3);
          s.box("#514b3d", px, y + 0.95, pz, 0.35, 0.07, 0.33);
          for (const dx of [-0.13, 0.13])
            for (const dz of [-0.12, 0.12])
              s.box("#514b3d", px + dx, y + 0.76, pz + dz, 0.025, 0.36, 0.025);
          const light = new THREE.Mesh(
            new THREE.BoxGeometry(0.23, 0.28, 0.21),
            new THREE.MeshBasicMaterial({ color: "#ffdc91" }),
          );
          light.position.set(px, y + 0.76, pz);
          group.add(light);
        }
        if (b === Block.Campfire) {
          lamps.push({ x: px, y: y + 0.6, z: pz, fire: true });
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            s.add(
              new THREE.IcosahedronGeometry(0.115, 0),
              "#8b8d7c",
              [px + Math.cos(a) * 0.35, y + 0.1, pz + Math.sin(a) * 0.35],
              [1, 0.7, 1],
            );
          }
          for (const angle of [-0.6, 0.7])
            s.box("#714a30", px, y + 0.18, pz, 0.14, 0.13, 0.66, [0, angle, 0]);
          const flame = new THREE.Group();
          flame.position.set(px, y + 0.26, pz);
          const m = new THREE.MeshBasicMaterial({
            color: "#f6b45b",
            transparent: true,
            opacity: 0.85,
          });
          for (let i = 0; i < 3; i++) {
            const f = new THREE.Mesh(
              new THREE.ConeGeometry(0.14, 0.44 - i * 0.08, 6),
              m,
            );
            f.position.set((i - 1) * 0.105, 0.18, 0);
            flame.add(f);
          }
          group.add(flame);
          flames.push(flame);
        }
        if (b === Block.Planter) {
          s.box("#a57550", px, y + 0.25, pz, 0.8, 0.5, 0.8);
          s.box("#5e5138", px, y + 0.51, pz, 0.68, 0.03, 0.68);
          for (let i = 0; i < 5; i++)
            flower(
              s,
              px + Math.sin(i * 4) * 0.23,
              y + 0.53,
              pz + Math.cos(i * 4) * 0.23,
              ["#ebbe8b", "#d8b0ce", "#e1d6a2"][i % 3],
              1,
            );
        }
        if (b === Block.Feeder) {
          for (const dx of [-0.3, 0.3])
            s.box("#6e5940", px + dx, y + 0.26, pz, 0.12, 0.5, 0.6);
          s.box("#b38c5c", px, y + 0.5, pz, 0.85, 0.13, 0.65);
          for (const dz of [-0.3, 0.3])
            s.box("#967446", px, y + 0.68, pz + dz, 0.85, 0.24, 0.08);
          s.box("#79824a", px, y + 0.61, pz, 0.66, 0.08, 0.5);
        }
      }
    }
  if (any)
    s.finish(group, new THREE.MeshLambertMaterial({ vertexColors: true }));
  if (waterPositions.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(waterPositions, 3),
    );
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({
      color: "#679b9a",
      transparent: true,
      opacity: 0.64,
      roughness: 0.25,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    group.add(mesh);
    // Small original ripple arcs lie on the shallow water surface.
    if (cx === 0 && cz === 1) {
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.7 + i * 0.45, 0.712 + i * 0.45, 40),
          new THREE.MeshBasicMaterial({
            color: "#c3ded2",
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(8.5, 3.145, 27.5);
        group.add(ring);
      }
    }
  }
  return { group, flames, lamps };
}
export function forageModel(kind: number): THREE.Group {
  const g = new THREE.Group(),
    s = new Surface();
  if (kind === 0)
    for (let i = 0; i < 3; i++)
      s.box("#977249", (i - 1) * 0.12, 0.12 + i * 0.025, 0, 0.12, 0.11, 0.5, [
        0,
        i * 0.25,
        0,
      ]);
  if (kind === 1)
    for (let i = 0; i < 4; i++)
      s.add(
        new THREE.IcosahedronGeometry(0.16, 0),
        "#adb4a1",
        [Math.sin(i * 3) * 0.17, 0.12, Math.cos(i * 3) * 0.14],
        [1, 0.75, 1],
      );
  if (kind === 2)
    for (let i = 0; i < 7; i++)
      s.add(
        new THREE.ConeGeometry(0.045, 0.47, 4),
        "#b4bb7d",
        [Math.sin(i * 3) * 0.13, 0.23, Math.cos(i * 3) * 0.13],
        [1, 1, 1],
        [0.15, 0, i * 0.08],
      );
  if (kind === 3) {
    s.add(
      new THREE.IcosahedronGeometry(0.34, 1),
      "#5b7549",
      [0, 0.25, 0],
      [1, 0.8, 1],
    );
    for (let i = 0; i < 9; i++)
      s.add(new THREE.IcosahedronGeometry(0.045, 1), "#bd767f", [
        Math.sin(i * 3) * 0.27,
        0.3 + (i % 3) * 0.06,
        Math.cos(i * 3) * 0.27,
      ]);
  }
  s.finish(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.33, 0.37, 28),
    new THREE.MeshBasicMaterial({
      color: kind === 3 ? "#eeadbf" : "#e6da9c",
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  g.add(ring);
  return g;
}
export class ForageDisplay {
  readonly group = new THREE.Group();
  private nodes: THREE.Group[];
  constructor(private sim: Simulation) {
    this.nodes = sim.forage.map((n) => {
      const g = forageModel(n.kind);
      g.position.set(n.x, n.y, n.z);
      this.group.add(g);
      return g;
    });
  }
  update() {
    this.nodes.forEach(
      (g, i) => (g.visible = this.sim.forageReady(this.sim.forage[i])),
    );
  }
}
