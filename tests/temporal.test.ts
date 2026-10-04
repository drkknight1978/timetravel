import { describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { actor, Block, HZ, idle, type Command } from "../src/model";
import { advance, compressVoxels, expandVoxels, History } from "../src/history";
import { blocked, intersectingBlocks, moveActor } from "../src/physics";
import { Simulation } from "../src/simulation";
import { FixedClock, Temporal } from "../src/temporal";
import { SITES, Voxels } from "../src/world";
function fixture(window = 300 * HZ) {
  const voxels = new Voxels();
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) voxels.set(x, 0, z, Block.Bedrock, false);
  voxels.pending = [];
  const sim = new Simulation(voxels);
  sim.actors = [actor(1, "player", 10.5, 1, 10.5)];
  sim.nextId = 6;
  const history = new History(sim, window),
    temporal = new Temporal(sim, history);
  return { sim, history, temporal };
}
function ticks(
  sim: Simulation,
  h: History,
  n: number,
  command: Command = idle(sim.player),
) {
  for (let i = 0; i < n; i++) advance(sim, h, command);
}
function branch(t: Temporal, tick: number, x: number, z = 10.5) {
  t.enter();
  t.seek(tick);
  t.traveller.x = x;
  t.traveller.z = z;
  t.traveller.y = 1;
  return t.resume();
}
describe("voxel and temporal history", () => {
  it("reverses destruction and placement and marks both sides of chunk boundaries", () => {
    const { sim, history, temporal } = fixture();
    sim.player.x = 14.5;
    history.record([], true);
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 15, y: 1, z: 10, block: Block.Wood },
    });
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 15, y: 1, z: 10, block: Block.Air },
    });
    expect(sim.voxels.get(15, 1, 10)).toBe(Block.Air);
    sim.voxels.dirty.clear();
    temporal.enter();
    temporal.seek(1);
    expect(sim.voxels.get(15, 1, 10)).toBe(Block.Wood);
    expect(sim.voxels.dirty.has("0,0,0")).toBe(true);
    expect(sim.voxels.dirty.has("1,0,0")).toBe(true);
    temporal.seek(0);
    expect(sim.voxels.get(15, 1, 10)).toBe(Block.Air);
    temporal.seek(2);
    expect(sim.voxels.get(15, 1, 10)).toBe(Block.Air);
  });
  it("restores all worker state, paths, jobs, randomness, and actor existence exactly", () => {
    const sim = new Simulation(),
      history = new History(sim);
    ticks(sim, history, 500);
    const snapshot = sim.snapshot(),
      voxels = sim.voxels.data.slice();
    ticks(sim, history, 300);
    sim.actors = sim.actors.filter((a) => a.id !== 2);
    history.record([], true);
    history.seek(500);
    expect(sim.snapshot()).toEqual(snapshot);
    expect(sim.voxels.data).toEqual(voxels);
    ticks(sim, new History(sim), 200);
    const replayed = sim.snapshot();
    sim.restore(snapshot);
    sim.voxels.restore(voxels);
    for (let i = 0; i < 200; i++) sim.step(idle(sim.player));
    expect(sim.snapshot()).toEqual(replayed);
  });
  it("freezes every world variable while the traveller moves with gravity", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 60);
    temporal.enter();
    const s = sim.snapshot(),
      size = history.frames.size;
    for (let i = 0; i < 30; i++)
      temporal.update({ ...idle(temporal.view), mx: 1, jump: i === 0 });
    expect(sim.snapshot()).toEqual(s);
    expect(history.frames.size).toBe(size);
    expect(temporal.view.x).toBeGreaterThan(12);
    expect(temporal.view.y).toBeGreaterThan(1);
    for (let i = 0; i < 100; i++) temporal.stepIdle();
    expect(temporal.view.y).toBeCloseTo(1, 3);
  });
  it("restores the original recording and player position when cancelling", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 180, { ...idle(sim.player), mx: 1 });
    const before = sim.snapshot(),
      latest = history.latest;
    temporal.enter();
    temporal.seek(30);
    temporal.traveller.z += 5;
    temporal.seek(120);
    temporal.cancel();
    expect(sim.snapshot()).toEqual(before);
    expect(history.latest).toBe(latest);
    expect(temporal.mode).toBe("live");
  });
  it("branches into a new incarnation, preserves earlier history, and deletes abandoned future frames", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 180, { ...idle(sim.player), mx: 1 });
    const old = history.frames.get(20);
    expect(branch(temporal, 60, 10.5, 14.5)).toEqual({
      ok: true,
      branched: true,
    });
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(1);
    expect(sim.player.id).not.toBe(1);
    expect(sim.player.z).toBe(14.5);
    expect(sim.tick).toBe(60);
    expect(history.latest).toBe(60);
    expect(history.frames.has(61)).toBe(false);
    expect(history.frames.get(20)).toBe(old);
    expect(history.frames.get(60)?.arrivals).toEqual([sim.player.id]);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    expect(sim.replays.get(echo.program)?.commands).toHaveLength(120);
  });
  it("past selves collide with a new wall and do not force their previous transforms", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 60, { ...idle(sim.player), mx: 1 });
    branch(temporal, 0, 10.5, 14.5);
    for (let y = 1; y <= 3; y++) sim.voxels.set(12, y, 10, Block.Stone);
    history.record([], true);
    ticks(sim, history, 90);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    expect(echo.x).toBeLessThan(11.701);
    expect(echo.x).toBeGreaterThan(11);
    expect(echo.cursor).toBe(60);
    const end = echo.x;
    ticks(sim, history, 30);
    expect(echo.x).toBe(end);
  });
  it("failed recorded edits remain attempts and cannot overwrite a changed block", () => {
    const { sim, history, temporal } = fixture();
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 12, y: 1, z: 10, block: Block.Wood, expected: Block.Air },
    });
    ticks(sim, history, 5);
    branch(temporal, 0, 10.5, 14.5);
    sim.voxels.set(12, 1, 10, Block.Stone);
    history.record([], true);
    ticks(sim, history, 5);
    expect(sim.voxels.get(12, 1, 10)).toBe(Block.Stone);
  });
  it("restores existing echoes and their cursors during another rewind", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 120, { ...idle(sim.player), mx: 1 });
    branch(temporal, 30, 10.5, 14.5);
    ticks(sim, history, 40);
    const at70 = sim.snapshot();
    ticks(sim, history, 20);
    temporal.enter();
    temporal.seek(70);
    expect(sim.snapshot()).toEqual(at70);
    temporal.traveller.x = 20;
    temporal.traveller.z = 20;
    temporal.traveller.y = 1;
    expect(temporal.resume().ok).toBe(true);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(2);
    expect(new Set(sim.actors.map((a) => a.id)).size).toBe(sim.actors.length);
  });
  it("can branch before an earlier arrival without borrowing successor commands", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 100, { ...idle(sim.player), mx: 1 });
    branch(temporal, 50, 10.5, 14.5);
    const successor = sim.player.id;
    ticks(sim, history, 40, { ...idle(sim.player), mz: 1 });
    branch(temporal, 20, 22, 22);
    expect(sim.actors.some((a) => a.id === successor)).toBe(false);
    const echo = sim.actors.find((a) => a.kind === "echo")!,
      script = sim.replays.get(echo.program)!;
    expect(echo.id).toBe(1);
    expect(script.commands.every((c) => c.mz === 0)).toBe(true);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(1);
    ticks(sim, history, 100);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(1);
  });
  it("limits past selves at the restored time and frees slots before their births", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 100);
    branch(temporal, 70, 12, 14);
    ticks(sim, history, 60);
    branch(temporal, 100, 16, 14);
    ticks(sim, history, 60);
    branch(temporal, 130, 20, 14);
    ticks(sim, history, 60);
    temporal.enter();
    temporal.seek(150);
    temporal.traveller.x = 25;
    temporal.traveller.z = 20;
    expect(temporal.resume().reason).toContain("Three past selves");
    expect(temporal.mode).toBe("temporal");
    temporal.seek(60);
    expect(temporal.resume().ok).toBe(true);
    expect(sim.actors.filter((a) => a.kind === "echo")).toHaveLength(1);
  });
  it("rejects occupied return points but permits escape from newly restored blocks", () => {
    const { sim, history, temporal } = fixture();
    sim.voxels.set(12, 1, 10, Block.Wood);
    sim.voxels.set(12, 2, 10, Block.Wood);
    history.record([], true);
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 12, y: 1, z: 10, block: Block.Air },
    });
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 12, y: 2, z: 10, block: Block.Air },
    });
    temporal.enter();
    temporal.traveller.x = 12.5;
    temporal.seek(0);
    expect(temporal.resume().ok).toBe(false);
    for (let i = 0; i < 25; i++)
      temporal.update({ ...idle(temporal.view), mz: 1 });
    expect(intersectingBlocks(sim.voxels, temporal.view).size).toBe(0);
    expect(temporal.resume().ok).toBe(true);
  });
  it("does not permit ordinary movement through walls or repeated airborne jumps", () => {
    const { sim } = fixture();
    for (let z = 9; z <= 11; z++)
      for (let y = 1; y < 6; y++) sim.voxels.set(12, y, z, Block.Stone);
    for (let i = 0; i < 100; i++)
      moveActor(
        sim.voxels,
        sim.player,
        { ...idle(sim.player), mx: 1, jump: true },
        sim.actors,
      );
    expect(sim.player.x).toBeLessThan(11.701);
    expect(sim.player.y).toBeLessThan(2.6);
    expect(blocked(sim.voxels, sim.player, sim.actors, sim.playerId)).toBe(
      false,
    );
  });
  it("resuming at the present relocates one player without drawing a teleport segment", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 60, { ...idle(sim.player), mx: 1 });
    temporal.enter();
    temporal.traveller.z = 15;
    expect(temporal.resume()).toEqual({ ok: true, branched: false });
    expect(sim.actors).toHaveLength(1);
    ticks(sim, history, 24, { ...idle(sim.player), mx: 1 });
    expect(
      history
        .trails(sim.tick)
        .every((s) => Math.hypot(...s.to.map((v, i) => v - s.from[i])) < 2),
    ).toBe(true);
  });
  it("retains a seekable checkpoint and does not reopen evicted history after branching", () => {
    const { sim, history, temporal } = fixture(180);
    ticks(sim, history, 500);
    expect(history.oldest).toBe(320);
    temporal.enter();
    temporal.seek(-100);
    expect(sim.tick).toBe(320);
    temporal.traveller.x = 14;
    expect(temporal.resume().ok).toBe(true);
    expect(history.oldest).toBe(320);
    ticks(sim, history, 50);
    temporal.enter();
    temporal.seek(0);
    expect(sim.tick).toBe(320);
  });
  it("workers actually complete construction and dismantle, and rewind restores it", () => {
    const sim = new Simulation(),
      history = new History(sim);
    let builtTick = 0,
      removedTick = 0;
    const cell = SITES[0].cells[0];
    for (let i = 0; i < 9000; i++) {
      advance(sim, history);
      const value = sim.voxels.get(cell.x, cell.y, cell.z);
      if (value && builtTick === 0) builtTick = sim.tick;
      if (builtTick > 0 && !value) {
        removedTick = sim.tick;
        break;
      }
    }
    expect(builtTick).toBeGreaterThan(0);
    expect(removedTick).toBeGreaterThan(builtTick);
    history.seek(builtTick);
    expect(sim.voxels.get(cell.x, cell.y, cell.z)).toBe(cell.block);
  });
});
describe("browser clock", () => {
  it("pauses without catch-up, discards tab suspension gaps, and advances at 60 Hz", () => {
    const clock = new FixedClock();
    let n = 0;
    const step = () => n++;
    clock.frame(0, true, step);
    clock.frame(100, true, step);
    expect(n).toBe(6);
    clock.frame(10000, false, step);
    clock.frame(20000, true, step);
    expect(n).toBe(6);
    clock.frame(20100, true, step);
    expect(n).toBe(12);
    clock.frame(30000, true, step);
    expect(n).toBe(12);
  });
});

describe("history storage and interaction regressions", () => {
  it("losslessly compresses checkpoints and falls back to raw storage for noisy terrain", () => {
    for (const voxels of [
      new Uint8Array(131072),
      Uint8Array.from({ length: 131072 }, (_, i) => i % 8),
    ]) {
      const packed = compressVoxels(voxels);
      expect(packed.byteLength).toBeLessThanOrEqual(voxels.byteLength);
      expect(expandVoxels(packed, voxels.length)).toEqual(voxels);
    }
  });
  it("retains arrival markers through repeated temporal entry without adding voxel checkpoints", () => {
    const { sim, history, temporal } = fixture();
    ticks(sim, history, 35);
    branch(temporal, 20, 15, 15);
    for (let i = 0; i < 25; i++) {
      temporal.enter();
      temporal.resume();
      advance(sim, history);
    }
    expect(history.arrivals().some((a) => a.tick === 20)).toBe(true);
    expect(
      [...history.frames.values()].filter((f) => f.checkpoint),
    ).toHaveLength(1);
  });
  it("past-self edit attempts cannot reach through a newly built wall", () => {
    const { sim, history, temporal } = fixture();
    sim.voxels.set(14, 2, 10, Block.Wood);
    history.record([], true);
    advance(sim, history, {
      ...idle(sim.player),
      edit: { x: 14, y: 2, z: 10, block: Block.Air, expected: Block.Wood },
    });
    branch(temporal, 0, 10.5, 14.5);
    sim.voxels.set(12, 2, 10, Block.Stone);
    history.record([], true);
    advance(sim, history);
    expect(sim.voxels.get(14, 2, 10)).toBe(Block.Wood);
  });
  it("bounds five-minute history with four workers, four animals, three enemies and three full-length replay scripts", () => {
    setFlagsFromString("--expose_gc");
    const gc = runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage();
    const sim = new Simulation();
    for (let i = 0; i < 3; i++) {
      const replay = sim.createReplay(
        Array.from({ length: 18000 }, () => idle(sim.player)),
      );
      const echo = actor(sim.nextId++, "echo", 15 + i * 3, 5, 38);
      echo.program = replay.id;
      sim.actors.push(echo);
    }
    const history = new History(sim);
    const start = performance.now();
    ticks(sim, history, 18240);
    const elapsed = performance.now() - start,
      bytes = history.bytes();
    gc();
    const after = process.memoryUsage();
    const retainedMiB =
      (after.heapUsed -
        before.heapUsed +
        after.arrayBuffers -
        before.arrayBuffers) /
      1048576;
    console.info(
      JSON.stringify({
        benchmark: "five-minute history, 15 actors, 3 replay scripts",
        estimatedMiB: +(bytes / 1048576).toFixed(2),
        retainedMiB: +retainedMiB.toFixed(2),
        simulationMs: +elapsed.toFixed(1),
        frames: history.frames.size,
      }),
    );
    expect(history.oldest).toBe(240);
    expect(history.frames.size).toBe(18001);
    expect(bytes).toBeLessThan(64 * 1048576);
    expect(retainedMiB).toBeLessThan(64);
    const end = sim.snapshot(),
      blocks = sim.voxels.data.slice();
    history.seek(history.oldest);
    history.seek(history.latest);
    expect(sim.snapshot()).toEqual(end);
    expect(sim.voxels.data).toEqual(blocks);
  }, 20000);
});
