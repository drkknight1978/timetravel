import * as THREE from "three";
import { Surface, type Human } from "./humans";
import type { Actor, Vec3 } from "./model";

// Original geometry, readable silhouettes, and tick-driven poses. These rigs only
// consume recorded state: rewinding never asks an animation clock to guess a pose.
export const ENEMY_VISUALS = [
  { name: "Raider", colour: "#ff736b", cloth: "#943a3c", trim: "#dcc2a0" },
  { name: "Warden", colour: "#ffd277", cloth: "#9f7839", trim: "#e1b867" },
  { name: "Hunter", colour: "#c3a2ff", cloth: "#655085", trim: "#ac8ad3" },
] as const;
export function enemyAppearance(role: number) {
  return ENEMY_VISUALS[role] ?? ENEMY_VISUALS[0];
}
export function enemyActivity(a: Actor): string {
  if (a.combat?.health === 0) return "Defeated · rewind to restore";
  const health = `${Math.ceil(a.combat?.health ?? 100)} health`;
  if (a.task === 2)
    return a.role === 2 ? "Aiming · take cover" : "Strike coming · step aside";
  if (a.task === 3) return "Recovering · strike now";
  if (a.task === 1)
    return a.role === 1 ? `${health} · shield raised` : `${health} · pursuing`;
  return `${health} · patrolling`;
}
type Joint = THREE.Group;
function joint(parent: THREE.Object3D, x = 0, y = 0, z = 0): Joint {
  const result = new THREE.Group();
  result.position.set(x, y, z);
  parent.add(result);
  return result;
}
function material() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
  });
}
export function createSword(colour = "#cbd5d3", heavy = false): THREE.Group {
  const root = new THREE.Group(),
    s = new Surface();
  s.box("#43372e", 0, 0, 0.025, 0.038, 0.048, 0.18);
  s.box("#b8a676", 0, 0, -0.06, heavy ? 0.3 : 0.23, 0.038, 0.034);
  s.box(
    colour,
    0,
    0,
    heavy ? -0.44 : -0.365,
    heavy ? 0.09 : 0.064,
    0.022,
    heavy ? 0.7 : 0.57,
  );
  s.box(
    "#f5f1da",
    0,
    -0.012,
    heavy ? -0.44 : -0.365,
    0.012,
    0.006,
    heavy ? 0.7 : 0.57,
  );
  s.add(
    new THREE.ConeGeometry(heavy ? 0.046 : 0.033, 0.13, 4),
    colour,
    [0, 0, heavy ? -0.845 : -0.71],
    [1, 0.6, 1],
    [-Math.PI / 2, 0, 0],
  );
  s.finish(root, material());
  return root;
}
export function createCrossbow(colour = "#b99b70"): THREE.Group {
  const root = new THREE.Group(),
    s = new Surface();
  s.box("#46352a", 0, 0, -0.16, 0.057, 0.066, 0.49);
  s.box(colour, 0, 0.018, -0.31, 0.48, 0.035, 0.036);
  for (const side of [-1, 1]) {
    s.box("#646d72", side * 0.225, 0.012, -0.265, 0.17, 0.027, 0.029, [
      0,
      side * 0.58,
      0,
    ]);
    s.box("#ded6b4", side * 0.133, 0.015, -0.145, 0.29, 0.006, 0.006, [
      0,
      side * -0.44,
      0,
    ]);
  }
  s.box("#d7dacc", 0, 0.044, -0.26, 0.013, 0.014, 0.4);
  s.box("#918474", 0, -0.063, 0.012, 0.04, 0.12, 0.05, [-0.2, 0, 0]);
  s.finish(root, material());
  return root;
}
function createShield(colour: string): THREE.Group {
  const root = new THREE.Group(),
    s = new Surface();
  s.add(
    new THREE.CylinderGeometry(0.305, 0.305, 0.07, 8),
    "#3f4140",
    [0, 0, -0.08],
    [1, 1, 1.28],
    [Math.PI / 2, 0, 0],
  );
  s.add(
    new THREE.CylinderGeometry(0.28, 0.28, 0.078, 8),
    colour,
    [0, 0, -0.08],
    [1, 1, 1.28],
    [Math.PI / 2, 0, 0],
  );
  s.box("#f7d995", 0, 0, -0.123, 0.049, 0.63, 0.014);
  s.box("#f7d995", 0, 0.055, -0.126, 0.45, 0.038, 0.014);
  s.oval("#41494d", 0, 0.04, -0.145, 0.079, 0.079, 0.042);
  s.finish(root, material());
  return root;
}
export interface EnemyRig {
  root: THREE.Group;
  body: Joint;
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
  warning: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  glint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  role: number;
  weapon: THREE.Group;
  shield?: THREE.Group;
}
// Arms position hands, while this counterrotation keeps a held item facing the
// actor's target instead of inheriting the elbow's bend (a vertical crossbow).
function orientHeld(
  item: THREE.Group,
  arm: Joint,
  elbow: Joint,
  pitch = 0,
  roll = 0,
): void {
  item.quaternion
    .copy(arm.quaternion)
    .multiply(elbow.quaternion)
    .invert()
    .multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll)),
    );
}
export function createEnemy(a: Actor): EnemyRig {
  const p = enemyAppearance(a.role),
    warden = a.role === 1,
    hunter = a.role === 2;
  const root = new THREE.Group(),
    body = joint(root),
    torso = joint(body, 0, 0.9);
  if (warden) body.scale.set(1.3, 1.17, 1.15);
  const m = material(),
    skin = hunter ? "#b18a6a" : "#c99a76",
    dark = "#30353d";
  const jacket = new Surface();
  jacket.form(p.cloth, [
    [-0.025, 0.15, 0.11],
    [0.13, 0.16, 0.115],
    [0.39, 0.21, 0.13],
    [0.49, 0.115, 0.085],
  ]);
  jacket.form(dark, [
    [-0.025, 0.16, 0.12],
    [0.027, 0.16, 0.12],
  ]);
  jacket.box(p.trim, 0, 0.005, -0.13, 0.055, 0.045, 0.025);
  jacket.oval(skin, 0, 0.53, 0, 0.059, 0.068, 0.055);
  if (warden) {
    jacket.form("#676b6c", [
      [0.12, 0.171, 0.129],
      [0.32, 0.207, 0.144],
      [0.44, 0.213, 0.124],
    ]);
    jacket.box(p.trim, 0, 0.3, -0.145, 0.09, 0.25, 0.02);
    for (const side of [-1, 1])
      jacket.oval(p.trim, side * 0.21, 0.425, 0, 0.115, 0.084, 0.15);
  } else if (hunter) {
    // Split long coat and a small quiver form a triangular silhouette.
    for (const side of [-1, 1])
      jacket.box(p.cloth, side * 0.112, -0.135, 0.057, 0.19, 0.34, 0.12, [
        0.1,
        0,
        side * 0.11,
      ]);
    jacket.box("#46372f", 0.105, 0.25, 0.165, 0.13, 0.41, 0.13, [0, 0, -0.3]);
    for (let i = 0; i < 3; i++) {
      jacket.box(
        "#c1ad7c",
        0.025 + i * 0.032,
        0.47,
        0.174,
        0.012,
        0.25,
        0.012,
        [0, 0, -0.3],
      );
      jacket.box(
        p.trim,
        -0.01 + i * 0.032,
        0.575,
        0.174,
        0.018,
        0.04,
        0.048,
        [0, 0, -0.3],
      );
    }
  } else {
    jacket.box("#c5ac86", 0, 0.24, -0.129, 0.055, 0.43, 0.028, [0, 0, -0.48]);
    jacket.oval("#bc4947", 0, 0.49, -0.017, 0.108, 0.074, 0.104);
    jacket.box(
      "#b73f42",
      -0.12,
      0.34,
      0.147,
      0.125,
      0.36,
      0.025,
      [0.1, 0, 0.15],
    );
  }
  jacket.finish(torso, m);
  const head = joint(torso, 0, 0.55),
    face = new Surface();
  face.oval(skin, 0, 0.102, -0.007, 0.085, 0.122, 0.083);
  face.oval(skin, 0, 0.069, -0.085, 0.013, 0.024, 0.019);
  for (const side of [-1, 1]) {
    face.oval(dark, side * 0.034, 0.12, -0.086, 0.018, 0.004, 0.004);
    face.oval("#e6d1b0", side * 0.034, 0.104, -0.087, 0.015, 0.006, 0.006);
    face.oval("#2b3230", side * 0.034, 0.103, -0.092, 0.006, 0.006, 0.002);
    face.oval(skin, side * 0.085, 0.082, 0, 0.016, 0.029, 0.019);
  }
  if (warden) {
    face.oval("#747875", 0, 0.13, 0.014, 0.111, 0.146, 0.107);
    face.box("#262e34", 0, 0.111, -0.091, 0.173, 0.025, 0.035);
    face.box(p.trim, 0, 0.163, -0.096, 0.024, 0.105, 0.02);
    face.box(p.trim, 0, 0.02, -0.082, 0.045, 0.097, 0.04);
    face.box(p.cloth, 0, 0.29, 0.012, 0.028, 0.1, 0.15);
  } else if (hunter) {
    face.oval(p.cloth, 0, 0.142, 0.033, 0.125, 0.166, 0.114);
    // Open hood rim frames a visible masked face.
    face.oval("#37303f", 0, 0.115, -0.071, 0.091, 0.112, 0.055);
    face.box(p.trim, 0, 0.105, -0.125, 0.111, 0.013, 0.009);
    face.oval("#1e242e", 0, 0.056, -0.109, 0.074, 0.037, 0.035);
    for (const side of [-1, 1])
      face.box("#e2d7b7", side * 0.031, 0.12, -0.125, 0.024, 0.009, 0.007);
  } else {
    face.oval("#312925", 0, 0.195, 0.009, 0.088, 0.049, 0.084);
    face.box("#3b2925", 0, 0.248, 0.01, 0.035, 0.092, 0.123);
    face.oval(p.cloth, 0, 0.043, -0.06, 0.081, 0.032, 0.056);
  }
  face.finish(head, m);
  function arm(side: number): [Joint, Joint] {
    const shoulder = joint(torso, side * 0.225, 0.424),
      upper = new Surface();
    upper.form(warden ? "#666d6d" : p.cloth, [
      [-0.27, 0.041, 0.046],
      [-0.15, 0.058, 0.06],
      [0.012, 0.067, 0.07],
    ]);
    upper.oval(p.cloth, 0, 0, 0, 0.069, 0.067, 0.073);
    upper.finish(shoulder, m);
    const elbow = joint(shoulder, 0, -0.268),
      lower = new Surface();
    lower.form(warden ? "#585f62" : dark, [
      [-0.238, 0.03, 0.032],
      [-0.05, 0.049, 0.047],
      [0, 0.046, 0.045],
    ]);
    lower.box(p.trim, 0, -0.137, -0.047, 0.063, 0.11, 0.015);
    lower.oval(skin, 0, -0.275, -0.005, 0.034, 0.049, 0.028);
    lower.finish(elbow, m);
    return [shoulder, elbow];
  }
  const [leftArm, leftElbow] = arm(-1),
    [rightArm, rightElbow] = arm(1);
  function leg(side: number): [Joint, Joint] {
    const hip = joint(body, side * 0.09, 0.86),
      thigh = new Surface();
    thigh.form(dark, [
      [-0.39, 0.052, 0.057],
      [-0.16, 0.072, 0.075],
      [0.025, 0.077, 0.081],
    ]);
    thigh.finish(hip, m);
    const knee = joint(hip, 0, -0.39),
      shin = new Surface();
    shin.oval(warden ? "#777b74" : p.cloth, 0, 0, -0.025, 0.064, 0.078, 0.055);
    shin.form(dark, [
      [-0.33, 0.047, 0.05],
      [-0.13, 0.054, 0.053],
      [0.015, 0.05, 0.054],
    ]);
    shin.oval("#40372e", 0, -0.398, -0.04, 0.062, 0.069, 0.115);
    shin.oval("#242c2d", 0, -0.442, -0.04, 0.065, 0.025, 0.119);
    shin.finish(knee, m);
    return [hip, knee];
  }
  const [leftLeg, leftKnee] = leg(-1),
    [rightLeg, rightKnee] = leg(1);
  const weapon = hunter
    ? createCrossbow(p.trim)
    : createSword("#c9d3d0", warden);
  weapon.position.set(0, -0.276, -0.025);
  rightElbow.add(weapon);
  const shield = warden ? createShield(p.cloth) : undefined;
  if (shield) {
    shield.position.set(-0.015, -0.19, -0.03);
    leftElbow.add(shield);
  } else if (!hunter) {
    const knife = createSword("#a7bbbd");
    knife.scale.setScalar(0.7);
    knife.position.set(0, -0.28, -0.01);
    leftElbow.add(knife);
  }
  const warning = new THREE.Mesh(
    new THREE.RingGeometry(0.49, 0.57, 32),
    new THREE.MeshBasicMaterial({
      color: p.colour,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  warning.rotation.x = -Math.PI / 2;
  warning.position.y = 0.022;
  root.add(warning);
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: "#fff2ce", toneMapped: false }),
  );
  glint.position.set(0, 0, hunter ? -0.48 : warden ? -0.85 : -0.71);
  weapon.add(glint);
  return {
    root,
    body,
    torso,
    head,
    leftArm,
    rightArm,
    leftElbow,
    rightElbow,
    leftLeg,
    rightLeg,
    leftKnee,
    rightKnee,
    warning,
    glint,
    role: a.role,
    weapon,
    shield,
  };
}
export function poseEnemy(r: EnemyRig, a: Actor, tick: number): void {
  const dead = a.combat?.health === 0,
    warden = r.role === 1,
    hunter = r.role === 2;
  const phase = tick * (warden ? 0.09 : 0.15) + a.id,
    swing = Math.sin(phase) * (a.moving && !dead ? 1 : 0);
  r.body.rotation.set(dead ? -Math.PI / 2 : 0, 0, dead ? -0.14 : 0);
  r.body.position.y = dead ? 0.14 : 0;
  r.torso.position.y = 0.9 + Math.abs(swing) * 0.016;
  r.torso.rotation.set(a.moving ? 0.065 : 0, swing * 0.045, 0);
  r.head.rotation.set(0, Math.sin(tick * 0.02 + a.id) * 0.04, 0);
  r.leftLeg.rotation.set(-swing * 0.5, 0, 0);
  r.rightLeg.rotation.set(swing * 0.5, 0, 0);
  r.leftKnee.rotation.x = -Math.max(0, swing) * 0.8;
  r.rightKnee.rotation.x = -Math.max(0, -swing) * 0.8;
  r.leftArm.rotation.set(
    hunter ? 0.85 : warden ? 0.4 : swing * 0.3 + 0.2,
    hunter ? -0.55 : 0,
    -0.09,
  );
  r.rightArm.rotation.set(hunter ? 0.75 : -swing * 0.3 + 0.2, 0, 0.09);
  r.leftElbow.rotation.set(
    hunter ? 1.0 : warden ? 1.12 : 0.45,
    hunter ? -0.5 : 0,
    0,
  );
  r.rightElbow.rotation.set(hunter ? 0.96 : 0.6, 0, 0);
  const windup = a.task === 2 && !dead,
    recover = a.task === 3 && !dead;
  r.warning.visible = !dead;
  r.warning.material.opacity = windup
    ? 0.65 + Math.sin(tick * 0.65) * 0.3
    : 0.24;
  r.warning.scale.setScalar(windup ? 1.2 + Math.sin(tick * 0.25) * 0.05 : 1);
  r.glint.visible = windup;
  r.glint.scale.setScalar(1 + Math.sin(tick * 0.6) * 0.3);
  if (windup) {
    r.head.rotation.y = 0;
    r.torso.rotation.x = hunter ? -0.015 : -0.1;
    r.rightArm.rotation.set(
      hunter ? 1.01 : 2.2,
      hunter ? -0.06 : -0.2,
      hunter ? 0 : 0.28,
    );
    r.rightElbow.rotation.x = hunter ? 0.55 : 1.05;
    if (hunter) {
      r.leftArm.rotation.set(0.94, -0.55, -0.09);
      r.leftElbow.rotation.x = 0.9;
    }
  } else if (recover) {
    r.rightArm.rotation.set(hunter ? 0.5 : 0.8, 0.28, 0.03);
    r.rightElbow.rotation.x = hunter ? 1.2 : 0.3;
    r.torso.rotation.x = hunter ? 0.02 : 0.19;
  }
  if (!dead && a.combat && a.combat.hurtAt > 0 && tick - a.combat.hurtAt < 12) {
    r.torso.rotation.z =
      Math.sin(((tick - a.combat.hurtAt) / 12) * Math.PI) * 0.16;
    r.head.rotation.x = -0.13;
  }
  if (dead) {
    r.leftArm.rotation.set(0.2, 0, -0.7);
    r.rightArm.rotation.set(0.3, 0, 0.45);
    r.leftElbow.rotation.x = r.rightElbow.rotation.x = 0.2;
    r.head.rotation.x = -0.12;
  }
  if (hunter)
    orientHeld(
      r.weapon,
      r.rightArm,
      r.rightElbow,
      a.pitch - r.torso.rotation.x,
    );
  if (r.shield)
    orientHeld(r.shield, r.leftArm, r.leftElbow, -r.torso.rotation.x);
}
export interface HumanWeapons {
  sword: THREE.Group;
  crossbow: THREE.Group;
}
export function equipHuman(h: Human): HumanWeapons {
  const sword = createSword(),
    crossbow = createCrossbow();
  for (const weapon of [sword, crossbow]) {
    weapon.position.set(0, -0.285, -0.025);
    h.rightElbow.add(weapon);
  }
  return { sword, crossbow };
}
export function poseArmedHuman(
  h: Human,
  weapons: HumanWeapons,
  a: Actor,
  tick: number,
): void {
  const dead = a.combat?.health === 0,
    weapon = a.combat?.weapon ?? 0;
  weapons.sword.visible = weapon === 1;
  weapons.crossbow.visible = weapon === 2;
  h.root.rotation.x = 0;
  h.root.rotation.z = 0;
  h.leftLeg.position.y = h.rightLeg.position.y = 0.865;
  h.leftElbow.rotation.y = h.rightElbow.rotation.y = 0;
  if (dead) {
    // A kneeling, bowed incarnation remains visible and can be restored by rewind.
    h.torso.position.y = 0.45;
    h.torso.rotation.x = 0.55;
    h.head.rotation.x = 0.4;
    h.leftLeg.position.y = h.rightLeg.position.y = 0.4;
    h.leftLeg.rotation.x = h.rightLeg.rotation.x = 0.95;
    h.leftKnee.rotation.x = h.rightKnee.rotation.x = -1.6;
    h.leftArm.rotation.x = h.rightArm.rotation.x = 0.4;
    h.leftElbow.rotation.x = h.rightElbow.rotation.x = 0.8;
    orientHeld(weapons.crossbow, h.rightArm, h.rightElbow);
    return;
  }
  if (weapon === 2) {
    h.rightArm.rotation.set(0.88, -0.03, 0.04);
    h.rightElbow.rotation.x = 0.72;
    h.leftArm.rotation.set(0.85, -0.55, -0.06);
    h.leftElbow.rotation.x = 1;
    h.leftElbow.rotation.y = -0.5;
  } else if (weapon === 1) {
    h.rightArm.rotation.x += 0.2;
    h.rightElbow.rotation.x = 0.9;
    const swing = a.combat ? a.combat.readyAt - tick : 0;
    if (swing > 0) {
      h.rightArm.rotation.set(
        0.6 + Math.sin(Math.min(1, swing / 30) * Math.PI) * 1.2,
        -0.3,
        0.15,
      );
      h.rightElbow.rotation.x = 0.6;
    }
  }
  if (a.combat?.guarding) {
    h.rightArm.rotation.set(1.1, -0.6, 0.25);
    h.rightElbow.rotation.x = 1.25;
    h.leftArm.rotation.set(0.9, 0.25, -0.15);
    h.leftElbow.rotation.x = 1.15;
  }
  orientHeld(
    weapons.crossbow,
    h.rightArm,
    h.rightElbow,
    a.pitch - h.torso.rotation.x,
  );
  if (a.combat && a.combat.hurtAt > 0 && tick - a.combat.hurtAt < 12)
    h.torso.rotation.z +=
      Math.sin(((tick - a.combat.hurtAt) / 12) * Math.PI) * 0.14;
}

export interface VisibleCombatEffect {
  kind: "slash" | "bolt" | "hit" | "guard" | "defeat";
  from: Vec3;
  to: Vec3;
  tick: number;
  actorId: number;
}
/** Bounded, cosmetic effects. Tick time freezes them; seeking clears stale effects. */
export class CombatDisplay {
  readonly group = new THREE.Group();
  private active: {
    mesh: THREE.Mesh;
    tick: number;
    life: number;
    kind: VisibleCombatEffect["kind"];
  }[] = [];
  private lastTick = -1;
  private lastStamp = "";
  clear(): void {
    for (const { mesh } of this.active) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
    this.active = [];
    this.lastStamp = "";
  }
  update(
    effects: readonly VisibleCombatEffect[],
    tick: number,
    temporal: boolean,
  ): void {
    if (tick < this.lastTick || (temporal && tick !== this.lastTick))
      this.clear();
    this.lastTick = tick;
    if (!temporal)
      for (const e of effects) {
        const stamp = `${e.tick}:${e.actorId}:${e.kind}:${e.to.x}:${e.to.z}`;
        if (
          stamp === this.lastStamp ||
          this.active.some((v) => v.mesh.name === stamp)
        )
          continue;
        this.lastStamp = stamp;
        if (this.active.length >= 24) {
          const old = this.active.shift()!;
          old.mesh.geometry.dispose();
          (old.mesh.material as THREE.Material).dispose();
          old.mesh.removeFromParent();
        }
        const from = new THREE.Vector3(e.from.x, e.from.y, e.from.z),
          to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
        const colour =
          e.kind === "guard"
            ? "#a6e1ff"
            : e.kind === "hit" || e.kind === "defeat"
              ? "#ffd29a"
              : "#fff1c6";
        const mat = new THREE.MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const geometry =
          e.kind === "bolt"
            ? new THREE.CylinderGeometry(
                0.012,
                0.022,
                Math.max(0.01, from.distanceTo(to)),
                6,
              )
            : e.kind === "slash"
              ? new THREE.RingGeometry(0.55, 0.61, 18, 1, 0, Math.PI * 0.8)
              : e.kind === "guard" || e.kind === "defeat"
                ? new THREE.RingGeometry(0.18, 0.24, 20)
                : new THREE.IcosahedronGeometry(0.14, 0);
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.name = stamp;
        if (e.kind === "bolt") {
          mesh.position.copy(from).add(to).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            to.clone().sub(from).normalize(),
          );
        } else {
          mesh.position.copy(
            e.kind === "slash" ? from.clone().lerp(to, 0.6) : to,
          );
          mesh.lookAt(from);
          if (e.kind === "defeat") mesh.rotation.x = -Math.PI / 2;
        }
        this.group.add(mesh);
        this.active.push({
          mesh,
          tick: e.tick,
          kind: e.kind,
          life: e.kind === "defeat" ? 36 : e.kind === "bolt" ? 10 : 14,
        });
      }
    this.active = this.active.filter((v) => {
      const age = tick - v.tick;
      if (age >= v.life || age < 0) {
        v.mesh.geometry.dispose();
        (v.mesh.material as THREE.Material).dispose();
        v.mesh.removeFromParent();
        return false;
      }
      (v.mesh.material as THREE.MeshBasicMaterial).opacity =
        (1 - age / v.life) * 0.9;
      if (v.kind !== "bolt") v.mesh.scale.setScalar(1 + (age / v.life) * 1.8);
      return true;
    });
  }
}

/** Camera-held equipment is cosmetic; aiming and hit tests still use actor state. */
export class FirstPersonWeapons {
  readonly group = new THREE.Group();
  private sword = createSword();
  private crossbow = createCrossbow();
  constructor() {
    this.group.add(this.sword, this.crossbow);
    for (const weapon of [this.sword, this.crossbow]) {
      const hand = new Surface();
      hand.oval("#c99d79", 0.01, 0.005, 0.032, 0.046, 0.044, 0.051);
      for (let finger = 0; finger < 4; finger++)
        hand.oval(
          "#ae805d",
          -0.034 + finger * 0.019,
          -0.021,
          0.035,
          0.011,
          0.024,
          0.028,
        );
      hand.oval("#bc8b68", 0.048, 0.022, 0.016, 0.02, 0.016, 0.035);
      hand.oval("#bb916f", 0.035, -0.025, 0.127, 0.039, 0.041, 0.095);
      hand.box(
        "#546460",
        0.055,
        -0.03,
        0.227,
        0.091,
        0.095,
        0.17,
        [0, 0.11, 0],
      );
      hand.finish(weapon, material());
      weapon.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 200;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          m.depthTest = false;
          m.depthWrite = false;
        }
      });
    }
  }
  update(a: Actor, tick: number, temporal: boolean): void {
    const c = a.combat,
      weapon = c?.weapon ?? 0;
    this.group.visible = !temporal && !!c && c.health > 0 && weapon > 0;
    if (!this.group.visible) return;
    const bob = a.moving ? Math.sin(tick * 0.15) * 0.007 : 0;
    this.sword.visible = weapon === 1;
    this.crossbow.visible = weapon === 2;
    const remaining = Math.max(0, c!.readyAt - tick);
    const swing =
      weapon === 1 && remaining > 0
        ? Math.sin(Math.min(1, remaining / 27) * Math.PI)
        : 0;
    this.sword.scale.setScalar(0.68);
    this.sword.position.set(
      0.3 - swing * 0.24,
      -0.31 + bob + swing * 0.035,
      -0.48 - swing * 0.06,
    );
    this.sword.rotation.set(
      1.1 - swing * 0.9,
      -swing * 0.4,
      -0.28 + swing * 0.8,
    );
    if (c!.guarding) {
      this.sword.position.set(0.14, -0.27, -0.43);
      this.sword.rotation.set(1.25, 0.15, -0.95);
    }
    const recoil = weapon === 2 ? Math.max(0, (remaining - 40) / 8) : 0;
    this.crossbow.scale.setScalar(0.8);
    this.crossbow.position.set(0.17, -0.23 + bob, -0.49 + recoil * 0.1);
    this.crossbow.rotation.set(0.06 + recoil * 0.14, -0.025, -0.035);
  }
}
