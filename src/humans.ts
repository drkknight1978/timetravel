import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CREW } from "./crew";
import { WorkerTask, type Actor } from "./model";

// Original game-scale human rigs. Every surface is local geometry; animation
// reads recorded actor state and simulation ticks, never wall time or randomness.
type Colour = THREE.ColorRepresentation;
type Joint = THREE.Group;
export interface Human {
  root: THREE.Group;
  torso: Joint;
  head: Joint;
  leftArm: Joint;
  rightArm: Joint;
  leftElbow: Joint;
  rightElbow: Joint;
  leftLeg: Joint;
  rightLeg: Joint;
  leftKnee: Joint;
  rightKnee: Joint;
  eyes: Joint;
  cargo: THREE.Mesh;
  hammer: THREE.Group;
}
const profiles = [
  {
    skin: "#b47e5b",
    hair: "#30241d",
    trousers: "#344b46",
    shirt: "#d7d4bc",
    style: "bun",
    beard: false,
    width: 0.94,
  },
  {
    skin: "#d2a184",
    hair: "#554135",
    trousers: "#43505a",
    shirt: "#e0d6c0",
    style: "crop",
    beard: true,
    width: 1.03,
  },
  {
    skin: "#edc1a1",
    hair: "#813f25",
    trousers: "#384855",
    shirt: "#b8c7cb",
    style: "ponytail",
    beard: false,
    width: 0.97,
  },
  {
    skin: "#795038",
    hair: "#221d1c",
    trousers: "#41433e",
    shirt: "#d6c7ac",
    style: "curls",
    beard: false,
    width: 1,
  },
] as const;

/** Merge coloured surfaces per joint: face detail does not create dozens of draw calls. */
export class Surface {
  private parts: THREE.BufferGeometry[] = [];
  add(
    geometry: THREE.BufferGeometry,
    colour: Colour,
    position: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0],
  ): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    g.deleteAttribute("uv");
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(matrix);
    const c = new THREE.Color(colour),
      values = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < values.length; i += 3) {
      values[i] = c.r;
      values[i + 1] = c.g;
      values[i + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(values, 3));
    this.parts.push(g);
  }
  oval(
    colour: Colour,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotation: [number, number, number] = [0, 0, 0],
  ): void {
    this.add(
      new THREE.SphereGeometry(1, 20, 14),
      colour,
      [x, y, z],
      [sx, sy, sz],
      rotation,
    );
  }
  box(
    colour: Colour,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rotation: [number, number, number] = [0, 0, 0],
  ): void {
    this.add(
      new THREE.BoxGeometry(w, h, d),
      colour,
      [x, y, z],
      [1, 1, 1],
      rotation,
    );
  }
  // Y-aligned elliptical sections give clothes/limbs a continuous, shaped silhouette.
  form(colour: Colour, rings: Array<[number, number, number]>, z = 0): void {
    const segments = 24,
      vertices: number[] = [],
      indices: number[] = [];
    for (const [y, rx, rz] of rings)
      for (let n = 0; n <= segments; n++) {
        const a = (n / segments) * Math.PI * 2;
        vertices.push(Math.cos(a) * rx, y, Math.sin(a) * rz + z);
      }
    for (let r = 0; r < rings.length - 1; r++)
      for (let n = 0; n < segments; n++) {
        const a = r * (segments + 1) + n,
          b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    // Smooth elliptical section normals; ends meet the adjacent joint surfaces.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    this.add(g, colour);
  }
  finish(parent: THREE.Object3D, material: THREE.Material): THREE.Mesh {
    const merged = mergeGeometries(this.parts)!;
    for (const part of this.parts) part.dispose();
    this.parts = [];
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
}
function joint(parent: THREE.Object3D, x: number, y: number, z = 0): Joint {
  const result = new THREE.Group();
  result.position.set(x, y, z);
  parent.add(result);
  return result;
}

export function createHuman(a: Actor): Human {
  const profile = profiles[a.kind === "worker" ? Math.max(0, a.id - 2) % 4 : 1];
  const colour =
    a.kind === "echo"
      ? "#ac8bd3"
      : a.kind === "player"
        ? "#d5bf65"
        : CREW.find((w) => w.id === a.id)!.colour;
  // Muted cloth panels retain crew identity without neon skin or plastic clothing.
  const vest = new THREE.Color(colour).lerp(new THREE.Color("#34413a"), 0.28);
  const seam = new THREE.Color(vest).multiplyScalar(0.72),
    skin = profile.skin;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
  });
  const root = new THREE.Group(),
    torso = joint(root, 0, 0.92);
  torso.scale.x = profile.width;
  const body = new Surface();
  body.form(profile.shirt, [
    [0, 0.135, 0.105],
    [0.1, 0.145, 0.106],
    [0.3, 0.19, 0.112],
    [0.44, 0.208, 0.102],
    [0.5, 0.11, 0.076],
  ]);
  body.form(vest, [
    [0.015, 0.148, 0.113],
    [0.17, 0.153, 0.116],
    [0.34, 0.195, 0.121],
    [0.44, 0.208, 0.11],
    [0.49, 0.107, 0.079],
  ]);
  body.form(skin, [
    [0.485, 0.058, 0.053],
    [0.558, 0.054, 0.05],
  ]);
  // Shirt opening, zip, chest pockets, reflective strips and a small crew badge.
  body.box(profile.shirt, 0, 0.426, -0.109, 0.085, 0.085, 0.016);
  body.box("#27322f", 0, 0.238, -0.122, 0.009, 0.42, 0.011);
  for (const side of [-1, 1]) {
    body.box(seam, side * 0.089, 0.275, -0.118, 0.098, 0.09, 0.022);
    body.box(vest, side * 0.089, 0.308, -0.133, 0.102, 0.026, 0.01);
    body.box("#e2dcca", side * 0.114, 0.389, -0.114, 0.025, 0.105, 0.012);
  }
  body.box("#d2d5c0", 0.091, 0.278, -0.139, 0.037, 0.018, 0.005);
  body.form("#33302a", [
    [-0.02, 0.15, 0.115],
    [0.02, 0.15, 0.115],
  ]);
  body.box("#b3ac91", 0, 0, -0.12, 0.038, 0.027, 0.018);
  body.oval(profile.trousers, 0, -0.039, 0, 0.161, 0.099, 0.109);
  body.finish(torso, material);

  const head = joint(torso, 0, 0.558, -0.004),
    face = new Surface();
  const skinShade = new THREE.Color(skin).multiplyScalar(0.8);
  // About seven-and-a-half heads high: shaped jaw, cheekbones and a rounded skull.
  const skull = new THREE.SphereGeometry(1, 32, 24);
  const skullPoints = skull.getAttribute("position");
  for (let i = 0; i < skullPoints.count; i++) {
    const x = skullPoints.getX(i),
      y = skullPoints.getY(i),
      z = skullPoints.getZ(i);
    const jaw = 1 - Math.max(0, -y) * 0.19;
    skullPoints.setXYZ(
      i,
      x * 0.088 * jaw,
      y * 0.122 + 0.11,
      z < 0 ? -Math.pow(-z, 0.48) * 0.084 : z * 0.088,
    );
  }
  skull.computeVertexNormals();
  face.add(skull, skin);
  for (const side of [-1, 1]) {
    face.oval(skin, side * 0.086, 0.09, 0, 0.017, 0.031, 0.02);
    face.oval(skinShade, side * 0.094, 0.087, -0.011, 0.007, 0.019, 0.007);
    face.oval(profile.hair, side * 0.037, 0.13, -0.077, 0.026, 0.004, 0.004, [
      0,
      0,
      side * 0.09,
    ]);
  }
  face.oval(skin, 0, 0.093, -0.087, 0.011, 0.032, 0.012);
  face.oval(skin, 0, 0.075, -0.099, 0.016, 0.011, 0.014);
  const lip = new THREE.Color(skin).lerp(new THREE.Color("#914b46"), 0.38);
  face.oval(lip, 0, 0.038, -0.079, 0.024, 0.004, 0.004);
  face.oval(skinShade, 0, 0.039, -0.083, 0.022, 0.0016, 0.002);
  if (profile.beard) {
    face.oval(profile.hair, 0, 0.012, -0.045, 0.058, 0.027, 0.044);
    for (const s of [-1, 1])
      face.oval(profile.hair, s * 0.057, 0.035, -0.039, 0.016, 0.045, 0.024);
    face.oval(profile.hair, 0, 0.049, -0.087, 0.029, 0.006, 0.006);
  }
  // Sculpted hair cap with an open hairline and lower sides/back, not a sphere hat.
  const hairVertices: number[] = [],
    hairIndices: number[] = [];
  const around = 32,
    down = 16;
  for (let j = 0; j <= down; j++)
    for (let i = 0; i <= around; i++) {
      const angle = (i / around) * Math.PI * 2;
      const front = Math.max(0, -Math.sin(angle)),
        back = Math.max(0, Math.sin(angle));
      const limit = 1.7 - front * 0.48 + back * 0.35;
      const theta = (j / down) * limit;
      const wave = 1 + Math.sin(angle * 7 + theta * 5) * 0.017;
      hairVertices.push(
        Math.sin(theta) * Math.cos(angle) * 0.094 * wave,
        Math.cos(theta) * 0.125 + 0.114,
        Math.sin(angle) < 0
          ? -Math.pow(-Math.sin(theta) * Math.sin(angle), 0.48) * 0.094 * wave +
              0.001
          : Math.sin(theta) * Math.sin(angle) * 0.099 * wave + 0.006,
      );
    }
  for (let j = 0; j < down; j++)
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i,
        b = a + around + 1;
      hairIndices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const hairGeometry = new THREE.BufferGeometry();
  hairGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(hairVertices, 3),
  );
  hairGeometry.setIndex(hairIndices);
  hairGeometry.computeVertexNormals();
  face.add(hairGeometry, profile.hair);
  if (profile.style === "bun") {
    face.oval(profile.hair, 0, 0.17, 0.095, 0.054, 0.052, 0.048);
    face.oval(
      profile.hair,
      -0.038,
      0.164,
      -0.058,
      0.045,
      0.038,
      0.023,
      [0, 0, -0.4],
    );
  } else if (profile.style === "ponytail") {
    face.oval(profile.hair, 0, 0.125, 0.096, 0.033, 0.038, 0.046);
    face.oval(profile.hair, 0, 0.028, 0.12, 0.033, 0.109, 0.036, [-0.18, 0, 0]);
    face.oval(vest, 0, 0.107, 0.103, 0.034, 0.012, 0.026);
  } else if (profile.style === "curls") {
    for (let i = 0; i < 18; i++) {
      const angle = i * 2.39996,
        radius = 0.075 * Math.sqrt(i / 18);
      face.oval(
        profile.hair,
        Math.cos(angle) * radius,
        0.232 - radius * 0.3,
        Math.sin(angle) * radius + 0.012,
        0.026,
        0.024,
        0.024,
      );
    }
  }
  face.finish(head, material);
  const eyes = joint(head, 0, 0.112, -0.082),
    eyeSurface = new Surface();
  for (const side of [-1, 1]) {
    eyeSurface.oval("#dddccc", side * 0.034, 0, 0, 0.018, 0.0068, 0.005);
    eyeSurface.oval(
      "#4d5947",
      side * 0.034,
      -0.0006,
      -0.004,
      0.0055,
      0.0058,
      0.002,
    );
    eyeSurface.oval(
      "#172322",
      side * 0.034,
      -0.0006,
      -0.0058,
      0.0026,
      0.0036,
      0.0012,
    );
    eyeSurface.oval(
      "#f6eee0",
      side * 0.034 - 0.0015,
      0.0014,
      -0.007,
      0.001,
      0.0012,
      0.0006,
    );
  }
  eyeSurface.finish(eyes, material);

  function arm(side: number) {
    const shoulder = joint(torso, side * 0.213, 0.451);
    const upper = new Surface();
    upper.oval(profile.shirt, 0, -0.045, 0, 0.068, 0.069, 0.073);
    upper.form(profile.shirt, [
      [-0.19, 0.056, 0.06],
      [-0.07, 0.068, 0.07],
      [0.01, 0.055, 0.06],
    ]);
    upper.form(skin, [
      [-0.282, 0.042, 0.043],
      [-0.175, 0.052, 0.054],
    ]);
    upper.form(seam, [
      [-0.194, 0.058, 0.062],
      [-0.177, 0.058, 0.062],
    ]);
    upper.finish(shoulder, material);
    const elbow = joint(shoulder, 0, -0.272),
      forearm = new Surface();
    forearm.oval(skin, 0, -0.012, 0, 0.044, 0.05, 0.047);
    forearm.form(skin, [
      [-0.238, 0.026, 0.029],
      [-0.15, 0.038, 0.037],
      [-0.075, 0.046, 0.045],
      [0, 0.038, 0.04],
    ]);
    forearm.oval(skin, 0, -0.272, -0.002, 0.036, 0.049, 0.021);
    for (let f = 0; f < 4; f++)
      forearm.oval(
        skin,
        -0.026 + f * 0.017,
        -0.317 + Math.abs(f - 1.5) * 0.005,
        -0.005,
        0.0077,
        0.025,
        0.01,
      );
    forearm.oval(skin, -side * 0.033, -0.278, -0.013, 0.012, 0.029, 0.014, [
      0,
      0,
      -side * 0.4,
    ]);
    if (side === -1) {
      // work watch
      forearm.form("#373d37", [
        [-0.226, 0.03, 0.032],
        [-0.203, 0.032, 0.034],
      ]);
      forearm.box("#b9c3b6", 0, -0.215, -0.035, 0.03, 0.029, 0.009);
    }
    forearm.finish(elbow, material);
    return [shoulder, elbow];
  }
  const [leftArm, leftElbow] = arm(-1),
    [rightArm, rightElbow] = arm(1);
  function leg(side: number) {
    const hip = joint(root, side * 0.09, 0.865),
      thigh = new Surface();
    thigh.form(profile.trousers, [
      [-0.405, 0.056, 0.06],
      [-0.25, 0.073, 0.073],
      [-0.08, 0.088, 0.092],
      [0.035, 0.073, 0.087],
    ]);
    thigh.oval(profile.trousers, 0, 0.005, 0, 0.08, 0.055, 0.086);
    thigh.box("#4b514b", side * 0.073, -0.175, -0.004, 0.018, 0.115, 0.09);
    thigh.finish(hip, material);
    const knee = joint(hip, 0, -0.397),
      shin = new Surface();
    shin.oval(profile.trousers, 0, 0, -0.005, 0.057, 0.053, 0.064);
    shin.form(profile.trousers, [
      [-0.344, 0.041, 0.046],
      [-0.23, 0.048, 0.05],
      [-0.12, 0.059, 0.059],
      [0.01, 0.052, 0.057],
    ]);
    // Sturdy shaped boots: rounded toe, ankle shaft, heel, sole and laces.
    shin.oval("#65503b", 0, -0.365, -0.038, 0.057, 0.054, 0.11);
    shin.form("#65503b", [
      [-0.372, 0.056, 0.063],
      [-0.27, 0.05, 0.056],
    ]);
    shin.oval("#302e29", 0, -0.409, -0.036, 0.058, 0.018, 0.113);
    for (let i = 0; i < 3; i++)
      shin.box(
        "#b3a385",
        0,
        -0.324 - i * 0.014,
        -0.059 - i * 0.013,
        0.049,
        0.004,
        0.006,
      );
    shin.finish(knee, material);
    return [hip, knee];
  }
  const [leftLeg, leftKnee] = leg(-1),
    [rightLeg, rightKnee] = leg(1);
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.29, 0.32),
    new THREE.MeshStandardMaterial({
      color: a.role === 0 ? "#ae8253" : "#9ba9a5",
      roughness: 0.95,
    }),
  );
  cargo.position.set(0, 0.09, -0.32);
  cargo.castShadow = true;
  torso.add(cargo);
  const hammer = joint(rightElbow, 0, -0.283, -0.033),
    tool = new Surface();
  tool.add(
    new THREE.CylinderGeometry(0.017, 0.022, 0.26, 10),
    "#80603f",
    [0, 0, -0.045],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
  );
  tool.box("#636e71", 0, 0, -0.177, 0.123, 0.065, 0.065);
  tool.finish(hammer, material);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.33, 0.365, 32),
    new THREE.MeshBasicMaterial({
      color: colour,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.42,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.018;
  root.add(ring);
  return {
    root,
    torso,
    head,
    eyes,
    leftArm,
    rightArm,
    leftElbow,
    rightElbow,
    leftLeg,
    rightLeg,
    leftKnee,
    rightKnee,
    cargo,
    hammer,
  };
}

export function poseHuman(h: Human, a: Actor, tick: number): void {
  const t = tick / 60,
    phase = t * 7.6 + a.id * 0.8,
    walk = a.moving ? 1 : 0;
  const swing = Math.sin(phase) * walk,
    stride = 0.48;
  h.leftLeg.rotation.set(-swing * stride, 0, 0);
  h.rightLeg.rotation.set(swing * stride, 0, 0);
  h.leftKnee.rotation.x = -Math.max(0, swing) * 0.7;
  h.rightKnee.rotation.x = -Math.max(0, -swing) * 0.7;
  h.leftArm.rotation.set(swing * 0.32, 0, -0.065);
  h.rightArm.rotation.set(-swing * 0.32, 0, 0.065);
  h.leftElbow.rotation.x = 0.12 + Math.max(0, swing) * 0.2;
  h.rightElbow.rotation.x = 0.12 + Math.max(0, -swing) * 0.2;
  h.torso.position.y = 0.92 + Math.abs(Math.cos(phase)) * walk * 0.013;
  h.torso.rotation.set(walk * 0.025, swing * 0.035, -swing * 0.025);
  h.torso.scale.y = 1 + Math.sin(t * 1.7 + a.id) * 0.003;
  h.head.rotation.set(
    a.pitch * 0.3,
    Math.sin(t * 0.55 + a.id) * (walk ? 0.025 : 0.1),
    0,
  );
  const blink = (t + a.id * 0.93) % 4.3;
  h.eyes.scale.y =
    blink < 0.13 ? Math.max(0.07, Math.abs(blink - 0.065) / 0.065) : 1;
  h.cargo.visible = a.kind === "worker" && a.cargo > 0;
  h.hammer.visible = a.kind === "worker" && !h.cargo.visible;
  if (h.cargo.visible) {
    h.leftArm.rotation.set(0.32, 0.12, -0.06);
    h.rightArm.rotation.set(0.32, -0.12, 0.06);
    h.leftElbow.rotation.x = h.rightElbow.rotation.x = 1.15;
  }
  if (
    a.kind === "worker" &&
    (a.task === WorkerTask.Build || a.task === WorkerTask.Dismantle) &&
    tick < a.taskUntil
  ) {
    h.rightArm.rotation.x = 0.6 + Math.sin(t * 13) * 0.36;
    h.rightElbow.rotation.x = 0.8 + Math.sin(t * 13 + 0.5) * 0.5;
    h.torso.rotation.x = 0.09;
    h.head.rotation.x = 0.15;
    h.cargo.visible = false;
    h.hammer.visible = true;
  }
  if (a.kind === "worker" && a.task === WorkerTask.Listen) {
    h.hammer.visible = false;
    h.head.rotation.y = Math.sin(t * 0.9) * 0.035;
    h.head.rotation.x = Math.sin(t * 1.2) * 0.025;
    h.rightArm.rotation.x = 0.15;
    h.rightElbow.rotation.x = 0.55 + Math.sin(t * 1.4) * 0.1;
  }
  if (a.kind === "worker" && a.task === WorkerTask.Celebrate) {
    h.leftArm.rotation.set(1.9, 0, -0.3);
    h.rightArm.rotation.set(2.3 + Math.sin(t * 9) * 0.2, 0, 0.25);
    h.leftElbow.rotation.x = 0.8;
    h.rightElbow.rotation.x = 0.65;
    h.hammer.visible = false;
  }
}
