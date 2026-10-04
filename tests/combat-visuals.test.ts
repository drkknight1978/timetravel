import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CombatDisplay,
  FirstPersonWeapons,
  createEnemy,
  poseEnemy,
  equipHuman,
  poseArmedHuman,
} from "../src/combat-visuals";
import { createHuman, poseHuman } from "../src/humans";
import { actor, WorkerTask, type CombatEffect } from "../src/model";
import { ENEMIES } from "../src/combat";

function pose(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const values: { matrix: number[]; visible: boolean }[] = [];
  root.traverse((p) =>
    values.push({ matrix: p.matrixWorld.toArray(), visible: p.visible }),
  );
  return values;
}
function dispose(root: THREE.Object3D): void {
  root.traverse((p) => {
    if (!(p instanceof THREE.Mesh)) return;
    p.geometry.dispose();
    for (const m of Array.isArray(p.material) ? p.material : [p.material])
      m.dispose();
  });
}
function enemy(role: number) {
  const a = actor(10 + role, "enemy", 35, 5, 20);
  a.role = role;
  a.combat = Object.freeze({
    health: ENEMIES[role].health,
    weapon: role === 2 ? 2 : 1,
    readyAt: 0,
    hurtAt: 0,
    guarding: false,
  });
  return a;
}

describe("combat presentation follows recorded time", () => {
  it("restores each enemy wind-up exactly after walking, death, and frozen frames without changing the actor", () => {
    for (const role of [0, 1, 2]) {
      const a = enemy(role),
        rig = createEnemy(a);
      a.task = WorkerTask.Dismantle; // Enemy wind-up shares packed task value 2.
      a.taskUntil = 640;
      const original = structuredClone(a);
      poseEnemy(rig, a, 620);
      const woundUp = pose(rig.root),
        opacity = rig.warning.material.opacity;
      expect(rig.glint.visible).toBe(true);
      const walking = { ...a, moving: true, task: WorkerTask.Patrol };
      poseEnemy(rig, walking, 990);
      expect(pose(rig.root)).not.toEqual(woundUp);
      const defeated = {
        ...a,
        combat: Object.freeze({ ...a.combat!, health: 0 }),
      };
      poseEnemy(rig, defeated, 1100);
      const down = pose(rig.root);
      expect(rig.body.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect(rig.warning.visible).toBe(false);
      expect(rig.glint.visible).toBe(false);
      poseEnemy(rig, a, 620);
      expect(pose(rig.root)).toEqual(woundUp);
      for (let frame = 0; frame < 5; frame++) poseEnemy(rig, a, 620);
      expect(pose(rig.root)).toEqual(woundUp);
      expect(rig.warning.material.opacity).toEqual(opacity);
      poseEnemy(rig, defeated, 1100);
      expect(pose(rig.root)).toEqual(down);
      expect(a).toEqual(original);
      dispose(rig.root);
    }
  });

  it("keeps crossbows aimed forward and shields upright through articulated arm poses", () => {
    const hunter = enemy(2),
      warden = enemy(1),
      hr = createEnemy(hunter),
      wr = createEnemy(warden);
    for (const task of [0, 1, 2, 3]) {
      hunter.task = task;
      warden.task = task;
      poseEnemy(hr, hunter, 300);
      poseEnemy(wr, warden, 300);
      hr.root.updateMatrixWorld(true);
      wr.root.updateMatrixWorld(true);
      const bowForward = new THREE.Vector3(0, 0, -1).transformDirection(
        hr.weapon.matrixWorld,
      );
      const shieldForward = new THREE.Vector3(0, 0, -1).transformDirection(
        wr.shield!.matrixWorld,
      );
      expect(bowForward.z).toBeCloseTo(-1, 5);
      expect(bowForward.y).toBeCloseTo(0, 5);
      expect(shieldForward.z).toBeCloseTo(-1, 5);
      expect(shieldForward.y).toBeCloseTo(0, 5);
    }
    dispose(hr.root);
    dispose(wr.root);
  });

  it("restores armed past-self posture after defeat and does not borrow a later weapon", () => {
    const a = actor(20, "echo", 10, 1, 10),
      human = createHuman(a),
      weapons = equipHuman(human);
    a.combat = Object.freeze({
      health: 80,
      weapon: 2,
      readyAt: 740,
      hurtAt: 0,
      guarding: false,
    });
    const original = structuredClone(a);
    poseHuman(human, a, 700);
    poseArmedHuman(human, weapons, a, 700);
    const earlier = pose(human.root);
    const defeated = { ...a, combat: { ...a.combat, health: 0, weapon: 1 } };
    poseHuman(human, defeated, 900);
    poseArmedHuman(human, weapons, defeated, 900);
    expect(human.torso.position.y).toBe(0.45);
    expect(weapons.sword.visible).toBe(true);
    poseHuman(human, a, 700);
    poseArmedHuman(human, weapons, a, 700);
    expect(pose(human.root)).toEqual(earlier);
    expect(weapons.crossbow.visible).toBe(true);
    expect(weapons.sword.visible).toBe(false);
    expect(a).toEqual(original);
    dispose(human.root);
  });

  it("freezes held weapon recoil at the same tick and hides it during time travel or defeat", () => {
    const a = actor(1, "player", 10, 1, 10),
      held = new FirstPersonWeapons();
    a.moving = true;
    a.combat = Object.freeze({
      health: 100,
      weapon: 2,
      readyAt: 145,
      hurtAt: 0,
      guarding: false,
    });
    const original = structuredClone(a);
    held.update(a, 100, false);
    const recoil = pose(held.group);
    held.update(a, 140, false);
    expect(pose(held.group)).not.toEqual(recoil);
    held.update(a, 100, false);
    expect(pose(held.group)).toEqual(recoil);
    for (let frame = 0; frame < 5; frame++) held.update(a, 100, false);
    expect(pose(held.group)).toEqual(recoil);
    held.update(a, 100, true);
    expect(held.group.visible).toBe(false);
    held.update({ ...a, combat: { ...a.combat, health: 0 } }, 100, false);
    expect(held.group.visible).toBe(false);
    held.update(a, 100, false);
    expect(pose(held.group)).toEqual(recoil);
    expect(a).toEqual(original);
    dispose(held.group);
  });

  it("freezes hit effects, clears abandoned future effects, and shows a hitscan segment without invented flight", () => {
    const display = new CombatDisplay();
    const bolt: CombatEffect = {
      kind: "bolt",
      from: { x: 0, y: 1.5, z: 0 },
      to: { x: 0, y: 1.5, z: -6 },
      tick: 100,
      actorId: 1,
    };
    const original = structuredClone(bolt);
    display.update([bolt], 100, false);
    expect(display.group.children).toHaveLength(1);
    const mesh = display.group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.CylinderGeometry;
    expect(geometry.parameters.height).toBe(6);
    expect(mesh.position.toArray()).toEqual([0, 1.5, -3]);
    const atShot = pose(display.group),
      opacity = (mesh.material as THREE.MeshBasicMaterial).opacity;
    for (let frame = 0; frame < 5; frame++) display.update([bolt], 100, true);
    expect(pose(display.group)).toEqual(atShot);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBe(opacity);
    display.update([], 105, false);
    expect(mesh.position.toArray()).toEqual([0, 1.5, -3]); // Fades in place, not a simulated projectile.
    display.update([], 70, true);
    expect(display.group.children).toHaveLength(0);
    display.update([bolt], 100, true);
    expect(display.group.children).toHaveLength(0); // Forward preview cannot recreate abandoned effects.
    display.update(
      Array.from({ length: 40 }, (_, i) => ({
        ...bolt,
        tick: 200,
        actorId: i + 1,
      })),
      200,
      false,
    );
    expect(display.group.children).toHaveLength(24);
    display.update([], 250, false);
    expect(display.group.children).toHaveLength(0);
    expect(bolt).toEqual(original);
    display.clear();
  });
});
