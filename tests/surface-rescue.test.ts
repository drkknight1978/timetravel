import { describe, expect, it } from "vitest";
import { actor, Block, HEIGHT, idle } from "../src/model";
import { History } from "../src/history";
import { blocked, intersectingBlocks } from "../src/physics";
import { Simulation } from "../src/simulation";
import { Temporal } from "../src/temporal";
import { Voxels } from "../src/world";

function fixture(filled = true) {
  const voxels = new Voxels();
  if (filled) {
    for (let x = 0; x < 64; x++)
      for (let z = 0; z < 64; z++)
        for (let y = 0; y < 5; y++)
          voxels.set(x, y, z, y === 4 ? Block.Grass : Block.Stone, false);
  }
  const sim = new Simulation(voxels);
  sim.actors = [actor(1, "player", 20.5, 5, 20.5)];
  const history = new History(sim),
    temporal = new Temporal(sim, history);
  return { sim, history, temporal };
}

function dig(voxels: Voxels, radius = 0) {
  for (let x = 10 - radius; x <= 10 + radius; x++)
    for (let z = 10 - radius; z <= 10 + radius; z++)
      for (let y = 1; y < 5; y++) voxels.set(x, y, z, Block.Air);
}

describe("temporal return to the surface", () => {
  it("escapes a deep hole filled by rewind, offsetting the traveller without changing history", () => {
    const { sim, history, temporal } = fixture();
    dig(sim.voxels);
    Object.assign(sim.player, {
      x: 10.5,
      y: 1,
      z: 10.5,
      yaw: 1.2,
      pitch: -0.4,
    });
    sim.tick = 1;
    history.record([]);
    temporal.enter();
    temporal.seek(0);
    expect(intersectingBlocks(sim.voxels, temporal.view).size).toBeGreaterThan(
      0,
    );
    expect(temporal.returnProblem()).toContain("press T");
    const state = sim.snapshot(),
      data = sim.voxels.data.slice(),
      frames = [...history.frames.entries()],
      nextId = sim.nextId;
    expect(temporal.returnToSurface()).toEqual({ ok: true });
    expect(temporal.view.y).toBe(5);
    expect(
      Math.hypot(temporal.view.x - 10.5, temporal.view.z - 10.5),
    ).toBeGreaterThanOrEqual(1.2);
    expect(temporal.view.yaw).toBe(1.2);
    expect(temporal.view.pitch).toBe(-0.4);
    expect(temporal.view.vy).toBe(0);
    expect(temporal.view.grounded).toBe(true);
    expect(temporal.ignored.size).toBe(0);
    expect(temporal.mode).toBe("temporal");
    expect(sim.snapshot()).toEqual(state);
    expect(sim.voxels.data).toEqual(data);
    expect([...history.frames.entries()]).toEqual(frames);
    expect(history.latest).toBe(1);
    expect(sim.nextId).toBe(nextId);
    expect(sim.replays.size).toBe(0);
    expect(temporal.resume()).toEqual({ ok: true, branched: true });
    expect(sim.player.y).toBe(5);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(1);
  });

  it("prefers the nearby lip over another point on the floor of an open hole", () => {
    const { sim, history, temporal } = fixture();
    dig(sim.voxels, 2);
    Object.assign(sim.player, { x: 10.5, y: 1, z: 10.5 });
    history.record([], true);
    temporal.enter();
    expect(temporal.returnToSurface().ok).toBe(true);
    expect(temporal.view.y).toBe(5);
    expect(
      Math.hypot(temporal.view.x - 10.5, temporal.view.z - 10.5),
    ).toBeLessThanOrEqual(6);
    expect(temporal.resume()).toEqual({ ok: true, branched: false });
    expect(sim.actors).toHaveLength(1);
  });

  it("avoids the historical player and living characters, while defeated bodies do not obstruct it", () => {
    const { sim, history, temporal } = fixture();
    for (const [x, z] of [
      [8, 10],
      [10, 8],
      [12, 10],
    ])
      sim.voxels.set(x, 6, z, Block.Stone, false);
    Object.assign(sim.player, { x: 8.5, y: 7, z: 10.5 });
    const worker = actor(2, "worker", 10.5, 7, 8.5),
      defeated = actor(3, "enemy", 12.5, 7, 10.5);
    defeated.combat = Object.freeze({ ...defeated.combat!, health: 0 });
    sim.actors.push(worker, defeated);
    history.record([], true);
    sim.tick = 1;
    Object.assign(sim.player, { x: 10.5, y: 5, z: 10.5 });
    history.record([]);
    temporal.enter();
    temporal.seek(0);
    expect(temporal.returnToSurface().ok).toBe(true);
    expect(temporal.view).toMatchObject({ x: 12.5, y: 7, z: 10.5 });
    expect(blocked(sim.voxels, temporal.view, sim.actors, -1)).toBe(false);
    expect(temporal.resume().ok).toBe(true);
  });

  it("requires two clear blocks below the world ceiling and rejects trees and prop tops", () => {
    const { sim, history, temporal } = fixture(false);
    Object.assign(sim.player, { x: 10.5, y: 1, z: 10.5 });
    for (const [x, z, top] of [
      [8, 10, Block.Leaf],
      [10, 8, Block.Wood],
      [12, 10, Block.Workbench],
      [10, 12, Block.Lantern],
    ])
      sim.voxels.set(x, 6, z, top, false);
    sim.voxels.set(9, HEIGHT - 2, 9, Block.Stone, false);
    sim.voxels.set(15, 4, 10, Block.Grass, false);
    history.record([], true);
    temporal.enter();
    expect(temporal.returnToSurface().ok).toBe(true);
    expect(temporal.view).toMatchObject({ x: 15.5, y: 5, z: 10.5 });
  });

  it("finds a bounded distant fallback when no nearby column is safe", () => {
    const { sim, history, temporal } = fixture(false);
    Object.assign(sim.player, { x: 0.3, y: 1, z: 0.3 });
    sim.voxels.set(63, 3, 63, Block.Grass, false);
    history.record([], true);
    temporal.enter();
    expect(temporal.returnToSurface().ok).toBe(true);
    expect(temporal.view).toMatchObject({ x: 63.5, y: 4, z: 63.5 });
    expect(blocked(sim.voxels, temporal.view, sim.actors, sim.playerId)).toBe(
      false,
    );
  });

  it("fails without moving or changing the timeline and still permits cancellation", () => {
    const { sim, history, temporal } = fixture(false);
    const original = sim.snapshot();
    temporal.enter();
    temporal.traveller.x += 4;
    const before = { ...temporal.view };
    const result = temporal.returnToSurface();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("press C");
    expect(temporal.view).toEqual(before);
    expect(history.latest).toBe(0);
    temporal.cancel();
    expect(temporal.mode).toBe("live");
    expect(sim.snapshot()).toEqual(original);
  });

  it("does not teleport in live time or bypass regular collision after rescue", () => {
    const { sim, temporal } = fixture();
    const original = sim.snapshot();
    expect(temporal.returnToSurface().ok).toBe(false);
    expect(sim.snapshot()).toEqual(original);
    temporal.enter();
    expect(temporal.returnToSurface().ok).toBe(true);
    const x = Math.floor(temporal.view.x) + 1,
      z = Math.floor(temporal.view.z);
    for (let y = 5; y < 9; y++) sim.voxels.set(x, y, z, Block.Stone, false);
    for (let i = 0; i < 120; i++)
      temporal.update({ ...idle(temporal.view), mx: 1 });
    expect(temporal.view.x).toBeLessThanOrEqual(x - 0.29);
    expect(temporal.mode).toBe("temporal");
  });
});
