import { describe, it, expect } from "vitest";
import { Simulation } from "../src/simulation";
import { History, advance } from "../src/history";
import { Temporal } from "../src/temporal";
import { ActionType, type Action } from "../src/camp";
import {
  actor,
  idle,
  Block,
  WorkerTask,
  bodyHeight,
  bodyRadius,
} from "../src/model";
import { blocked, moveActor } from "../src/physics";
import { Voxels, createLandscape } from "../src/world";
import { createAnimal, poseAnimal } from "../src/animals";
import * as THREE from "three";
function action(sim: Simulation, h: History, a: Action) {
  advance(sim, h, { ...idle(sim.player), action: a });
}
function ticks(sim: Simulation, h: History, n: number) {
  for (let i = 0; i < n; i++) advance(sim, h);
}
function beside(sim: Simulation, target: { x: number; y: number; z: number }) {
  Object.assign(sim.player, {
    x: target.x + 1.6,
    y: target.y,
    z: target.z,
    yaw: Math.PI / 2,
    pitch: 0,
  });
}
function simple() {
  const v = new Voxels();
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) v.set(x, 0, z, Block.Bedrock, false);
  const sim = new Simulation(v);
  sim.actors = [actor(1, "player", 10.5, 1, 10.5)];
  return sim;
}
describe("rewindable camp life", () => {
  it("crafts atomically, rejects missing supplies and restores resources through seek and cancel", () => {
    const sim = new Simulation(),
      h = new History(sim),
      t = new Temporal(sim, h),
      initial = sim.camp;
    action(sim, h, { type: ActionType.Craft, target: 1 });
    expect(sim.camp.bag).toEqual([0, 0, 2, 2, 0, 1, 0, 0]);
    const crafted = sim.camp;
    action(sim, h, { type: ActionType.Craft, target: 1 });
    expect(sim.camp).toBe(crafted);
    t.enter();
    t.seek(0);
    expect(sim.camp).toBe(initial);
    t.seek(1);
    expect(sim.camp).toBe(crafted);
    t.cancel();
    expect(sim.camp).toBe(crafted);
  });
  it("gathers only reachable, uncovered patches and rewinds their regrowth timer", () => {
    const sim = new Simulation(),
      n = sim.forage[0];
    beside(sim, n);
    const h = new History(sim),
      initial = sim.camp;
    action(sim, h, { type: ActionType.Gather, target: n.id });
    expect(sim.camp.bag[0]).toBe(5);
    expect(sim.forageReady(n)).toBe(false);
    const gathered = sim.camp;
    action(sim, h, { type: ActionType.Gather, target: n.id });
    expect(sim.camp).toBe(gathered);
    h.seek(0);
    expect(sim.camp).toBe(initial);
    expect(sim.forageReady(n)).toBe(true);
    sim.voxels.set(Math.floor(n.x), n.y, Math.floor(n.z), Block.Stone);
    expect(
      sim.interact(sim.player, { type: ActionType.Gather, target: n.id }),
    ).toBe(false);
    sim.voxels.set(Math.floor(n.x), n.y, Math.floor(n.z), Block.Air);
    sim.player.x += 10;
    expect(
      sim.interact(sim.player, { type: ActionType.Gather, target: n.id }),
    ).toBe(false);
  });
  it("a past self retries crafting against the shared restored supplies", () => {
    const sim = simple(),
      h = new History(sim),
      t = new Temporal(sim, h);
    action(sim, h, { type: ActionType.Craft, target: 1 });
    ticks(sim, h, 15);
    t.enter();
    t.seek(0);
    t.traveller.z += 4;
    expect(t.resume().ok).toBe(true);
    // Both incarnations try the recipe on the same tick. Only the controlled player can afford it.
    action(sim, h, { type: ActionType.Craft, target: 1 });
    expect(sim.camp.bag[5]).toBe(1);
    expect(sim.camp.bag[0]).toBe(0);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    expect(sim.replays.get(echo.program)!.commands[0].action).toEqual({
      type: ActionType.Craft,
      target: 1,
      value: 0,
    });
    expect(
      Object.isFrozen(sim.replays.get(echo.program)!.commands[0].action),
    ).toBe(true);
  });
  it("crafted placement consumes stock only after success; breaking and rewind restore it", () => {
    const sim = simple(),
      h = new History(sim);
    action(sim, h, { type: ActionType.Craft, target: 0 });
    advance(sim, h, {
      ...idle(sim.player),
      edit: { x: 10, y: 1, z: 10, block: Block.Lantern },
    });
    expect(sim.camp.bag[4]).toBe(1);
    advance(sim, h, {
      ...idle(sim.player),
      edit: { x: 12, y: 1, z: 10, block: Block.Lantern },
    });
    expect(sim.camp.bag[4]).toBe(0);
    expect(sim.voxels.get(12, 1, 10)).toBe(Block.Lantern);
    advance(sim, h, {
      ...idle(sim.player),
      edit: { x: 12, y: 1, z: 10, block: Block.Air },
    });
    expect(sim.camp.bag[4]).toBe(1);
    h.seek(3);
    expect(sim.camp.bag[4]).toBe(0);
    expect(sim.voxels.get(12, 1, 10)).toBe(Block.Lantern);
    h.seek(2);
    expect(sim.camp.bag[4]).toBe(1);
    expect(sim.voxels.get(12, 1, 10)).toBe(Block.Air);
  });
  it("worker requests and expiring orders restore with job progress", () => {
    const sim = new Simulation(),
      worker = sim.actors.find((a) => a.id === 2)!;
    beside(sim, worker);
    sim.camp = { ...sim.camp, bag: [4, 2, 2, 2, 0, 0, 0, 0] };
    const h = new History(sim);
    action(sim, h, { type: ActionType.Accept, target: 2 });
    action(sim, h, { type: ActionType.Deliver, target: 2 });
    expect(sim.camp.requests[0]).toBe(2);
    expect(sim.camp.bag[4]).toBe(1);
    action(sim, h, { type: ActionType.Order, target: 2, value: 1 });
    const frozen = sim.snapshot();
    ticks(sim, h, 90);
    expect(worker.task).toBe(WorkerTask.Listen);
    expect(worker.x).toBe(frozen.actors.find((a) => a.id === 2)!.x);
    h.seek(frozen.tick);
    expect(sim.snapshot()).toEqual(frozen);
    h.seek(0);
    expect(sim.camp.requests[0]).toBe(0);
    expect(sim.camp.bag[4]).toBe(0);
  });
  it("conversation and feeding attempts cannot reach through a new wall", () => {
    const sim = simple(),
      npc = actor(2, "worker", 12.5, 1, 10.5);
    npc.site = 0;
    sim.actors.push(npc);
    sim.voxels.set(11, 2, 10, Block.Stone);
    expect(
      sim.interact(sim.player, { type: ActionType.Accept, target: 2 }),
    ).toBe(false);
    expect(sim.camp.requests[0]).toBe(0);
  });
  it("feeding consumes berries, observes snack cooldown, and restores trust and behaviour exactly", () => {
    const sim = new Simulation(),
      animal = sim.actors.find((a) => a.id === 6)!;
    beside(sim, animal);
    const h = new History(sim);
    action(sim, h, { type: ActionType.Feed, target: 6 });
    expect(animal.cargo).toBe(1);
    expect(sim.camp.bag[3]).toBe(1);
    const s = sim.snapshot();
    action(sim, h, { type: ActionType.Feed, target: 6 });
    expect(sim.camp.bag[3]).toBe(1);
    ticks(sim, h, 160);
    const future = sim.snapshot();
    h.seek(s.tick);
    expect(sim.snapshot()).toEqual(s);
    for (let i = 0; i < 161; i++) sim.step(idle(sim.player));
    expect(sim.snapshot()).toEqual(future);
  });
  it("the world and camp stay frozen while the temporal traveller attempts interactions", () => {
    const sim = new Simulation(),
      h = new History(sim),
      t = new Temporal(sim, h);
    ticks(sim, h, 60);
    t.enter();
    const s = sim.snapshot();
    for (let i = 0; i < 90; i++)
      t.update({
        ...idle(t.view),
        mx: 1,
        action: { type: ActionType.Craft, target: 0 },
      });
    expect(sim.snapshot()).toEqual(s);
    expect(t.view.x).toBeGreaterThan(s.actors[0].x + 2);
  });
  it("refills a solid feeder with a one-minute simulation timer and rewinds its existence", () => {
    const sim = simple();
    sim.camp = { ...sim.camp, bag: [0, 0, 0, 4, 0, 0, 0, 1] };
    const h = new History(sim);
    advance(sim, h, {
      ...idle(sim.player),
      edit: { x: 12, y: 1, z: 10, block: Block.Feeder },
    });
    expect(sim.camp.feeders).toHaveLength(1);
    ticks(sim, h, 30);
    action(sim, h, {
      type: ActionType.Refill,
      target: Voxels.index(12, 1, 10),
    });
    expect(sim.camp.bag[3]).toBe(2);
    expect(sim.camp.feeders[0].until).toBe(sim.tick + 3600);
    h.seek(0);
    expect(sim.camp.feeders).toHaveLength(0);
    expect(sim.camp.bag[7]).toBe(1);
  });
  it("wildlife wanders, remains grounded and has smaller physical bodies", () => {
    const sim = new Simulation(),
      initial = sim.actors
        .filter((a) => a.kind === "animal")
        .map((a) => ({ ...a }));
    for (let i = 0; i < 3000; i++) sim.step(idle(sim.player));
    for (const a of sim.actors.filter((a) => a.kind === "animal")) {
      const old = initial.find((b) => b.id === a.id)!;
      expect(Math.hypot(a.x - old.x, a.z - old.z)).toBeGreaterThan(1);
      expect(a.y).toBeGreaterThan(0);
      expect(bodyHeight(a)).toBeLessThan(1.75);
      expect(blocked(sim.voxels, a, sim.actors, a.id)).toBe(false);
    }
    const hare = actor(6, "animal", 10.5, 1, 10.5);
    expect(bodyRadius(hare)).toBe(0.2);
    const v = new Voxels();
    for (let x = 0; x < 20; x++)
      for (let z = 0; z < 20; z++) v.set(x, 0, z, Block.Bedrock, false);
    for (let y = 1; y < 4; y++) v.set(12, y, 10, Block.Stone);
    for (let i = 0; i < 100; i++)
      moveActor(v, hare, { ...idle(hare), mx: 1 }, [hare]);
    expect(hare.x).toBeLessThan(11.81);
  });
  it("has accessible varied terrain while retaining both flat construction sites", () => {
    const v = createLandscape();
    expect(v.ground(8, 27)).toBe(3);
    expect(v.ground(25, 8)).toBeGreaterThan(9);
    expect(v.get(30, 5, 42)).toBe(Block.Workbench);
    expect(v.get(23, 4, 24)).toBe(Block.Path);
    expect(v.get(43, 4, 30)).toBe(Block.Path);
  });
  it("animal animation restores the same pose and never edits the actor", () => {
    const a = actor(6, "animal", 0, 0, 0),
      r = createAnimal(a);
    a.moving = true;
    const before = structuredClone(a);
    const matrices = () => {
      r.root.updateMatrixWorld(true);
      const m: number[][] = [];
      r.root.traverse((o) => m.push(o.matrixWorld.toArray()));
      return m;
    };
    poseAnimal(r, a, 300);
    const first = matrices();
    poseAnimal(r, a, 900);
    expect(matrices()).not.toEqual(first);
    poseAnimal(r, a, 300);
    expect(matrices()).toEqual(first);
    expect(a).toEqual(before);
    r.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  });
  it("a worker removing a player-built feeder also removes its wildlife attraction", () => {
    const sim = simple();
    sim.camp = { ...sim.camp, bag: [0, 0, 0, 0, 0, 0, 0, 1] };
    expect(
      sim.edit(sim.player, { x: 12, y: 1, z: 10, block: Block.Feeder }),
    ).toBe(true);
    const worker = actor(2, "worker", 13.5, 1, 10.5);
    worker.site = 0;
    sim.actors.push(worker);
    expect(sim.camp.feeders).toHaveLength(1);
    expect(sim.edit(worker, { x: 12, y: 1, z: 10, block: Block.Air })).toBe(
      true,
    );
    expect(sim.camp.feeders).toHaveLength(0);
  });
  it("a restored animal follows the historical person who fed it across repeated branches", () => {
    const sim = simple(),
      pet = actor(6, "animal", 10.5, 1, 8.7);
    sim.actors.push(pet);
    sim.nextId = 10;
    const h = new History(sim),
      t = new Temporal(sim, h);
    action(sim, h, { type: ActionType.Feed, target: 6 });
    ticks(sim, h, 180);
    t.enter();
    t.seek(100);
    t.traveller.x = 15;
    expect(t.resume().ok).toBe(true);
    expect(sim.actors.find((a) => a.id === 6)!.program).toBe(1);
    ticks(sim, h, 50);
    const future = sim.snapshot();
    ticks(sim, h, 40);
    t.enter();
    t.seek(150);
    expect(sim.snapshot()).toEqual(future);
    t.traveller.z = 15;
    expect(t.resume().ok).toBe(true);
    expect(new Set(sim.actors.map((a) => a.id)).size).toBe(sim.actors.length);
    expect(sim.actors.find((a) => a.id === 6)!.program).toBe(1);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(2);
  });
  it("restores a high-coordinate feeder action from its packed recording", () => {
    const sim = simple();
    sim.player.x = 58.5;
    sim.player.y = 28;
    sim.player.z = 62.5;
    for (let x = 57; x < 64; x++)
      for (let z = 60; z < 64; z++)
        sim.voxels.set(x, 27, z, Block.Stone, false);
    sim.camp = { ...sim.camp, bag: [0, 0, 0, 4, 0, 0, 0, 1] };
    const h = new History(sim);
    advance(sim, h, {
      ...idle(sim.player),
      edit: { x: 60, y: 28, z: 62, block: Block.Feeder, expected: Block.Air },
    });
    action(sim, h, {
      type: ActionType.Refill,
      target: Voxels.index(60, 28, 62),
    });
    const script = h.script(1, 0, 2);
    expect(script[0].edit).toEqual({
      x: 60,
      y: 28,
      z: 62,
      block: Block.Feeder,
      expected: Block.Air,
    });
    expect(script[1].action).toEqual({
      type: ActionType.Refill,
      target: Voxels.index(60, 28, 62),
      value: 0,
    });
  });
});
