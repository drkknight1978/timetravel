import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { CREW, workerActivity } from "./crew";
import { createAnimal, poseAnimal, type AnimalRig } from "./animals";
import {
  terrainAtlas,
  decorateChunk,
  ForageDisplay,
  isProp,
  type ChunkDecoration,
} from "./scenery";
import { animalName, animalActivity } from "./camp";
import { createHuman, poseHuman, type Human } from "./humans";
import { ENEMIES } from "./combat";
import {
  createEnemy,
  poseEnemy,
  enemyAppearance,
  enemyActivity,
  equipHuman,
  poseArmedHuman,
  CombatDisplay,
  FirstPersonWeapons,
  type EnemyRig,
  type HumanWeapons,
} from "./combat-visuals";
import {
  Block,
  CHUNK,
  EYE_HEIGHT,
  bodyHeight,
  bodyRadius,
  alive,
  overlap,
  type Actor,
} from "./model";
import { History } from "./history";
import { Simulation } from "./simulation";
import { Temporal } from "./temporal";
import { raycast, Voxels } from "./world";
import { intersectingBlocks } from "./physics";
const COLOURS = [
  0, 0x91a365, 0x9c7854, 0xa1a69a, 0xad7951, 0x527653, 0xc4ae82, 0x6a726b,
  0x967048, 0xf2c77b, 0x98714c, 0xa68059, 0x9b885c, 0xb08c60, 0xd4c795,
  0x8b9995,
];
const FACES = [
  {
    d: [1, 0, 0],
    v: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 1],
      [1, 1, 0],
    ],
    shade: 0.83,
  },
  {
    d: [-1, 0, 0],
    v: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [0, 1, 1],
    ],
    shade: 0.68,
  },
  {
    d: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
    ],
    shade: 1,
  },
  {
    d: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ],
    shade: 0.5,
  },
  {
    d: [0, 0, 1],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
    shade: 0.8,
  },
  {
    d: [0, 0, -1],
    v: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 0.7,
  },
];
interface Puppet {
  group: THREE.Group;
  human?: Human;
  animal?: AnimalRig;
  enemy?: EnemyRig;
  weapons?: HumanWeapons;
  kind: string;
  label?: THREE.Sprite;
  labelText?: string;
  labelCanvas?: HTMLCanvasElement;
}
export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 130);
  private terrain = new Map<string, THREE.Mesh>();
  private decorations = new Map<string, ChunkDecoration>();
  private forage: ForageDisplay;
  private campLights = Array.from(
    { length: 3 },
    () => new THREE.PointLight("#ffce8b", 0, 7, 2),
  );
  private puppets = new Map<number, Puppet>();
  private combatDisplay = new CombatDisplay();
  private heldWeapons = new FirstPersonWeapons();
  private terrainMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: terrainAtlas(),
  });
  private trails = new THREE.Group();
  private trailStamp = -1;
  private lastTrailTime = 0;
  private temporalLast = false;
  private target: THREE.LineSegments;
  private returnBox: THREE.LineSegments;
  private lastActors = new Map<number, Actor>();
  private sun: THREE.DirectionalLight;
  private sky = new THREE.Color("#cbdcd0");
  private fog = new THREE.Fog("#cbdcd0", 42, 100);
  constructor(
    container: HTMLElement,
    readonly sim: Simulation,
    readonly history: History,
    readonly temporal: Temporal,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Timetravel voxel world",
    );
    container.append(this.renderer.domElement);
    this.scene.background = this.sky;
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight("#eef3d8", "#646c51", 2.1));
    this.sun = new THREE.DirectionalLight("#fff2c9", 2.5);
    this.sun.position.set(16, 40, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -40,
      right: 40,
      top: 40,
      bottom: -40,
      near: 1,
      far: 100,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.target.position.set(32, 0, 32);
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.trails, this.combatDisplay.group, this.camera);
    this.camera.add(this.heldWeapons.group);
    this.forage = new ForageDisplay(sim);
    this.scene.add(this.forage.group);
    this.scene.add(...this.campLights);
    this.target = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012)),
      new THREE.LineBasicMaterial({
        color: "#f8f4cc",
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.scene.add(this.target);
    this.returnBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.64, 1.78, 0.64)),
      new THREE.LineBasicMaterial({
        color: "#ff997e",
        depthTest: false,
        transparent: true,
        opacity: 0.7,
      }),
    );
    this.scene.add(this.returnBox);
    // Soft cloud clusters, all original geometry. Clouds are tied to world time and freeze with it.
    const cloudMaterial = new THREE.MeshLambertMaterial({ color: "#f1efdb" });
    for (const [x, y, z, s] of [
      [8, 24, 4, 1.5],
      [46, 27, 9, 1.7],
      [22, 25, 54, 1.1],
      [63, 26, 42, 1.4],
    ]) {
      const cloud = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const part = new THREE.Mesh(
          new THREE.BoxGeometry(5 + i * 2, 1.2, 3.8),
          cloudMaterial,
        );
        part.position.set(i * 2, i * 0.35, 0);
        cloud.add(part);
      }
      cloud.position.set(x, y, z);
      cloud.scale.setScalar(s);
      this.scene.add(cloud);
    }
    addEventListener("resize", () => this.resize());
    this.resize();
  }
  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  capturePrevious(): void {
    this.lastActors = new Map(this.sim.actors.map((a) => [a.id, { ...a }]));
  }
  resetInterpolation(): void {
    this.lastActors.clear();
    this.combatDisplay.clear();
  }
  private rebuild(): void {
    for (const key of this.sim.voxels.dirty) {
      const [cx, cy, cz] = key.split(",").map(Number),
        positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [],
        colours: number[] = [],
        indices: number[] = [];
      for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++)
        for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++)
          for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) {
            const block = this.sim.voxels.get(x, y, z);
            if (!block || isProp(block)) continue;
            for (const f of FACES) {
              const neighbour = this.sim.voxels.get(
                x + f.d[0],
                y + f.d[1],
                z + f.d[2],
              );
              if (neighbour && !isProp(neighbour)) continue;
              const colour = new THREE.Color(COLOURS[block]);
              const grain =
                ((Math.imul(x + 13, 73856093) ^
                  Math.imul(y + 19, 19349663) ^
                  Math.imul(z + 7, 83492791)) >>>
                  0) %
                11;
              colour.multiplyScalar(f.shade * (0.94 + grain * 0.012));
              if (block === Block.Grass && f.d[1] === 0)
                colour.lerp(new THREE.Color(COLOURS[Block.Dirt]), 0.35);
              const base = positions.length / 3;
              uvs.push(
                (block * 16 + 0.5) / 256,
                0.03125,
                (block * 16 + 15.5) / 256,
                0.03125,
                (block * 16 + 0.5) / 256,
                0.96875,
                (block * 16 + 15.5) / 256,
                0.96875,
              );
              for (const p of f.v) {
                positions.push(x + p[0], y + p[1], z + p[2]);
                normals.push(...f.d);
                colours.push(colour.r, colour.g, colour.b);
              }
              indices.push(
                base,
                base + 1,
                base + 2,
                base + 2,
                base + 1,
                base + 3,
              );
            }
          }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colours, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      const decoration = this.decorations.get(key);
      if (decoration) this.disposeGroup(decoration.group);
      const next = decorateChunk(this.sim.voxels, cx, cy, cz);
      this.decorations.set(key, next);
      this.scene.add(next.group);
      const old = this.terrain.get(key);
      if (old) {
        old.geometry.dispose();
        old.geometry = geometry;
      } else {
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.terrain.set(key, mesh);
      }
    }
    this.sim.voxels.dirty.clear();
  }
  private puppet(a: Actor): Puppet {
    const human =
        a.kind === "animal" || a.kind === "enemy" ? undefined : createHuman(a),
      animal = a.kind === "animal" ? createAnimal(a) : undefined,
      enemy = a.kind === "enemy" ? createEnemy(a) : undefined,
      weapons =
        human && (a.kind === "player" || a.kind === "echo")
          ? equipHuman(human)
          : undefined,
      group = human?.root ?? animal?.root ?? enemy!.root;
    let label: THREE.Sprite | undefined,
      labelCanvas: HTMLCanvasElement | undefined;
    if (a.kind === "worker" || a.kind === "animal" || a.kind === "enemy") {
      labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        }),
      );
      label.position.y =
        a.kind === "animal"
          ? a.role === 0
            ? 0.95
            : 1.85
          : bodyHeight(a) + 0.42;
      label.scale.set(2.15, 0.5375, 1);
      group.add(label);
    }
    this.scene.add(group);
    return {
      group,
      human,
      animal,
      enemy,
      weapons,
      kind: a.kind,
      label,
      labelCanvas,
    };
  }
  private disposeGroup(group: THREE.Group): void {
    group.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) m.dispose();
      }
    });
    group.removeFromParent();
  }
  private drawTrails(now: number): void {
    const enabled = this.temporal.mode === "temporal";
    this.trails.visible = enabled;
    if (!enabled) return;
    const stamp = this.sim.tick + this.history.revision * 100000;
    if (this.trailStamp === stamp || now - this.lastTrailTime < 120) return;
    this.lastTrailTime = now;
    this.trailStamp = stamp;
    for (const child of [...this.trails.children]) {
      if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      this.trails.remove(child);
    }
    for (const arrival of this.history.arrivals()) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.6, 4),
        new THREE.MeshBasicMaterial({
          color: 0xf1d981,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: arrival.tick > this.sim.tick ? 0.22 : 0.9,
          depthWrite: false,
        }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.rotation.z = Math.PI / 4;
      marker.position.set(arrival.x, arrival.y + 0.045, arrival.z);
      this.trails.add(marker);
    }
    const past: number[] = [],
      future: number[] = [],
      pc: number[] = [],
      fc: number[] = [];
    for (const s of this.history.trails(this.sim.tick)) {
      const points = s.future ? future : past,
        colors = s.future ? fc : pc;
      points.push(...s.from, ...s.to);
      const c = new THREE.Color(
        s.kind === 0
          ? 0xffe795
          : s.kind === 1
            ? 0xdcafff
            : s.kind === 3
              ? "#e4d7ab"
              : s.kind === 4
                ? enemyAppearance(
                    this.sim.actors.find((a) => a.id === s.id)?.role ?? 0,
                  ).colour
                : (CREW.find((w) => w.id === s.id)?.colour ?? "#8fffe6"),
      );
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (const [points, colors, isFuture] of [
      [past, pc, false],
      [future, fc, true],
    ] as [number[], number[], boolean][]) {
      if (!points.length) continue;
      for (const glow of [true, false]) {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(points);
        geometry.setColors(colors);
        const material = new LineMaterial({
          vertexColors: true,
          transparent: true,
          opacity: glow ? (isFuture ? 0.08 : 0.16) : isFuture ? 0.38 : 1,
          depthWrite: false,
          depthTest: false,
          linewidth: glow ? 13 : isFuture ? 3 : 4.5,
          dashed: isFuture,
          dashSize: 0.28,
          gapSize: 0.18,
          toneMapped: false,
        });
        const line = new LineSegments2(geometry, material);
        line.computeLineDistances();
        line.renderOrder = glow ? 4 : 5;
        this.trails.add(line);
      }
    }
    // Selected-time beacons connect each coloured recording to its character.
    for (const a of this.sim.actors) {
      const colour =
        a.kind === "player"
          ? 0xffe795
          : a.kind === "echo"
            ? 0xdcafff
            : a.kind === "animal"
              ? "#e4d7ab"
              : a.kind === "enemy"
                ? enemyAppearance(a.role).colour
                : (CREW.find((w) => w.id === a.id)?.colour ?? "#8fffe6");
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 10, 8),
        new THREE.MeshBasicMaterial({
          color: colour,
          depthTest: false,
          toneMapped: false,
        }),
      );
      beacon.position.set(a.x, a.y + 0.55, a.z);
      beacon.renderOrder = 6;
      this.trails.add(beacon);
    }
  }
  render(alpha: number, now: number): void {
    this.rebuild();
    this.forage.update();
    for (const d of this.decorations.values())
      for (const flame of d.flames) {
        flame.scale.y =
          1 + Math.sin(this.sim.tick * 0.3 + flame.position.x) * 0.12;
        flame.rotation.y = Math.sin(this.sim.tick * 0.09) * 0.08;
      }
    const temporal = this.temporal.mode === "temporal";
    if (temporal !== this.temporalLast) {
      this.temporalLast = temporal;
      this.trailStamp = -1;
      this.lastTrailTime = -Infinity;
      this.resetInterpolation();
    }
    const targetColour = new THREE.Color(temporal ? "#263e43" : "#cbdcd0");
    this.sky.lerp(targetColour, 0.045);
    this.fog.color.copy(this.sky);
    this.sun.intensity = THREE.MathUtils.lerp(
      this.sun.intensity,
      temporal ? 0.65 : 2.5,
      0.045,
    );
    const p = this.temporal.view,
      prev = temporal ? undefined : this.lastActors.get(p.id);
    this.camera.position.set(
      prev ? THREE.MathUtils.lerp(prev.x, p.x, alpha) : p.x,
      (prev ? THREE.MathUtils.lerp(prev.y, p.y, alpha) : p.y) + EYE_HEIGHT,
      prev ? THREE.MathUtils.lerp(prev.z, p.z, alpha) : p.z,
    );
    this.camera.rotation.set(p.pitch, p.yaw, 0, "YXZ");
    this.heldWeapons.update(
      p,
      this.sim.tick + (temporal ? 0 : alpha),
      temporal,
    );
    const lamps = [...this.decorations.values()]
      .flatMap((d) => d.lamps)
      .sort(
        (a, b) =>
          Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      );
    this.campLights.forEach((light, i) => {
      const lamp = lamps[i];
      light.visible = !!lamp;
      if (lamp) {
        light.position.set(lamp.x, lamp.y, lamp.z);
        light.intensity = lamp.fire
          ? 4.5 + Math.sin(this.sim.tick * 0.3) * 0.4
          : 3.5;
      }
    });
    const ids = new Set(this.sim.actors.map((a) => a.id));
    for (const [id, puppet] of this.puppets)
      if (!ids.has(id)) {
        this.disposeGroup(puppet.group);
        this.puppets.delete(id);
      }
    for (const a of this.sim.actors) {
      let puppet = this.puppets.get(a.id);
      if (puppet && puppet.kind !== a.kind) {
        this.disposeGroup(puppet.group);
        this.puppets.delete(a.id);
        puppet = undefined;
      }
      if (!puppet) {
        puppet = this.puppet(a);
        this.puppets.set(a.id, puppet);
      }
      puppet.group.visible = a.id !== this.sim.playerId || temporal;
      if (temporal && a.id === this.sim.playerId)
        puppet.group.visible =
          this.sim.tick < this.temporal.entryTick && !overlap(p, a);
      const old = temporal ? undefined : this.lastActors.get(a.id);
      puppet.group.position.set(
        old ? THREE.MathUtils.lerp(old.x, a.x, alpha) : a.x,
        old ? THREE.MathUtils.lerp(old.y, a.y, alpha) : a.y,
        old ? THREE.MathUtils.lerp(old.z, a.z, alpha) : a.z,
      );
      puppet.group.rotation.y = a.yaw;
      if (puppet.human) {
        poseHuman(puppet.human, a, this.sim.tick + (temporal ? 0 : alpha));
        if (puppet.weapons)
          poseArmedHuman(
            puppet.human,
            puppet.weapons,
            a,
            this.sim.tick + (temporal ? 0 : alpha),
          );
      }
      if (puppet.enemy)
        poseEnemy(puppet.enemy, a, this.sim.tick + (temporal ? 0 : alpha));
      if (puppet.animal)
        poseAnimal(puppet.animal, a, this.sim.tick + (temporal ? 0 : alpha));
      if (puppet.label && puppet.labelCanvas) {
        const distance = this.camera.position.distanceTo(puppet.group.position);
        puppet.label.visible = distance < (a.kind === "animal" ? 12 : 24);
        const labelWidth = THREE.MathUtils.clamp(distance * 0.23, 0.65, 2.15);
        puppet.label.scale.set(labelWidth, labelWidth / 4, 1);
        puppet.label.position.y =
          a.kind === "enemy" && !alive(a)
            ? 0.65
            : a.kind === "animal"
              ? a.role === 0
                ? 0.95
                : 1.85
              : bodyHeight(a) + 0.42;
        const crew =
            a.kind === "enemy"
              ? enemyAppearance(a.role)
              : (CREW.find((w) => w.id === a.id) ?? {
                  name: animalName(a),
                  colour: "#e4d7ab",
                }),
          activity =
            a.kind === "enemy"
              ? enemyActivity(a)
              : a.kind === "animal"
                ? animalActivity(a)
                : workerActivity(a, this.sim.jobs),
          text = `${crew.name}|${activity}|${a.combat?.health ?? ""}`;
        if (puppet.labelText !== text) {
          puppet.labelText = text;
          const ctx = puppet.labelCanvas.getContext("2d")!;
          ctx.clearRect(0, 0, 512, 128);
          ctx.fillStyle = "#132c2bea";
          ctx.beginPath();
          ctx.roundRect(4, 4, 504, 120, 18);
          ctx.fill();
          ctx.fillStyle = crew.colour;
          ctx.textAlign = "center";
          ctx.font = "bold 34px sans-serif";
          ctx.fillText(crew.name.toUpperCase(), 256, 49);
          ctx.fillStyle = "#ecf5e5";
          ctx.font = a.kind === "enemy" ? "22px sans-serif" : "25px sans-serif";
          ctx.fillText(activity, 256, a.kind === "enemy" ? 83 : 92);
          if (a.kind === "enemy") {
            ctx.fillStyle = "#0e1b20";
            ctx.fillRect(32, 103, 448, 8);
            ctx.fillStyle = crew.colour;
            ctx.fillRect(
              32,
              103,
              448 *
                THREE.MathUtils.clamp(
                  (a.combat?.health ?? 0) / ENEMIES[a.role].health,
                  0,
                  1,
                ),
              8,
            );
          }
          puppet.label.material.map!.needsUpdate = true;
        }
      }
    }
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const hit = raycast(this.sim.voxels, this.camera.position, direction);
    this.target.visible = !!hit && !temporal && !p.combat?.weapon;
    if (hit) this.target.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    const obstacle = temporal
      ? intersectingBlocks(this.sim.voxels, p).values().next().value
      : undefined;
    const person = temporal
      ? this.sim.actors.find(
          (a) =>
            alive(a) &&
            (this.sim.tick < this.temporal.entryTick ||
              a.id !== this.sim.playerId) &&
            overlap(p, a),
        )
      : undefined;
    this.returnBox.visible = temporal && (obstacle !== undefined || !!person);
    if (obstacle !== undefined) {
      const cell = Voxels.position(obstacle);
      this.returnBox.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      this.returnBox.scale.set(1.02 / 0.64, 1.02 / 1.78, 1.02 / 0.64);
    } else if (person) {
      this.returnBox.position.set(
        person.x,
        person.y + bodyHeight(person) / 2,
        person.z,
      );
      this.returnBox.scale.set(
        (bodyRadius(person) * 2 + 0.04) / 0.64,
        (bodyHeight(person) + 0.03) / 1.78,
        (bodyRadius(person) * 2 + 0.04) / 0.64,
      );
    }
    this.drawTrails(now);
    this.combatDisplay.update(this.sim.effects, this.sim.tick, temporal);
    this.renderer.render(this.scene, this.camera);
  }
  get stats() {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
