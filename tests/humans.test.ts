import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createHuman, poseHuman } from "../src/humans";
import { actor, WorkerTask } from "../src/model";

function matrices(root: THREE.Object3D): number[][] {
  root.updateMatrixWorld(true);
  const result: number[][] = [];
  root.traverse((part) => result.push(part.matrixWorld.toArray()));
  return result;
}
function dispose(root: THREE.Object3D): void {
  root.traverse((part) => {
    if (part instanceof THREE.Mesh) {
      part.geometry.dispose();
      for (const m of Array.isArray(part.material)
        ? part.material
        : [part.material])
        m.dispose();
    }
  });
}
describe("human presentation respects recorded time", () => {
  it("restores exactly the same full rig pose when time is frozen or rewound", () => {
    const a = actor(2, "worker", 12, 5, 20),
      human = createHuman(a);
    a.moving = true;
    a.task = WorkerTask.Fetch;
    a.cargo = 3;
    const original = structuredClone(a);
    poseHuman(human, a, 620);
    const recorded = matrices(human.root);
    poseHuman(human, a, 1400);
    expect(matrices(human.root)).not.toEqual(recorded);
    poseHuman(human, a, 620);
    expect(matrices(human.root)).toEqual(recorded);
    for (let frame = 0; frame < 10; frame++) poseHuman(human, a, 620);
    expect(matrices(human.root)).toEqual(recorded);
    expect(a).toEqual(original); // Rendered breathing/blinking must never write simulation state.
    dispose(human.root);
  });
  it("restoring activity restores the appropriate cargo/tool pose without stale animation", () => {
    const a = actor(3, "worker", 12, 5, 20),
      human = createHuman(a);
    poseHuman(human, a, 900);
    const idle = matrices(human.root);
    a.task = WorkerTask.Build;
    a.taskUntil = 1200;
    poseHuman(human, a, 920);
    expect(human.hammer.visible).toBe(true);
    expect(human.rightElbow.rotation.x).toBeGreaterThan(0.25);
    a.task = WorkerTask.Deliver;
    a.cargo = 3;
    poseHuman(human, a, 980);
    expect(human.cargo.visible).toBe(true);
    expect(human.hammer.visible).toBe(false);
    a.task = WorkerTask.Patrol;
    a.taskUntil = 0;
    a.cargo = 0;
    poseHuman(human, a, 900);
    expect(matrices(human.root)).toEqual(idle);
    expect(human.cargo.visible).toBe(false);
    dispose(human.root);
  });
});
