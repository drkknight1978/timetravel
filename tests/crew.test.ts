import { describe, expect, it } from "vitest";
import { Simulation } from "../src/simulation";
import { advance, History } from "../src/history";
import { Temporal } from "../src/temporal";
import { idle, WorkerTask, Block } from "../src/model";
import { blueprintAt, SITES } from "../src/world";

describe("a living, rewindable crew", () => {
  it("all workers make substantial journeys, carry materials, inspect work and change blueprints", () => {
    const sim = new Simulation();
    const activity = new Map(
      sim.actors
        .filter((a) => a.kind === "worker")
        .map((a) => [
          a.id,
          {
            tasks: new Set<number>(),
            distance: 0,
            x: a.x,
            z: a.z,
            cargo: false,
          },
        ]),
    );
    for (let tick = 0; tick < 18000; tick++) {
      sim.step(idle(sim.player));
      for (const a of sim.actors.filter((a) => a.kind === "worker")) {
        const record = activity.get(a.id)!;
        record.tasks.add(a.task);
        record.distance += Math.hypot(a.x - record.x, a.z - record.z);
        record.x = a.x;
        record.z = a.z;
        record.cargo ||= a.cargo > 0;
      }
    }
    console.info(
      JSON.stringify({
        crewCycles: sim.jobs.map((j) => j.cycle),
        crew: [...activity].map(([id, r]) => ({
          id,
          distance: Math.round(r.distance),
          tasks: [...r.tasks],
          cargo: r.cargo,
        })),
      }),
    );
    for (const [id, r] of activity) {
      expect(
        r.distance,
        `worker ${id} must explore beyond the workbench`,
      ).toBeGreaterThan(50);
      expect(r.cargo, `worker ${id} must transport real cargo state`).toBe(
        true,
      );
      expect(
        r.tasks.has(WorkerTask.Inspect),
        `worker ${id} must complete a job`,
      ).toBe(true);
      expect(r.tasks.has(WorkerTask.Celebrate)).toBe(true);
    }
    for (const job of sim.jobs) expect(job.cycle).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < SITES.length; i++)
      expect(blueprintAt(i, 0).cells).not.toEqual(blueprintAt(i, 2).cells);
  }, 20000);
  it("cargo, destination progress, work timers, jobs and ensuing behaviour restore exactly", () => {
    const sim = new Simulation(),
      h = new History(sim),
      t = new Temporal(sim, h);
    for (let i = 0; i < 1500 && !sim.actors.some((a) => a.cargo > 0); i++)
      advance(sim, h);
    expect(sim.actors.some((a) => a.cargo > 0)).toBe(true);
    const state = sim.snapshot(),
      blocks = sim.voxels.data.slice();
    for (let i = 0; i < 180; i++) advance(sim, h);
    const later = sim.snapshot(),
      laterBlocks = sim.voxels.data.slice();
    t.enter();
    t.seek(state.tick);
    expect(sim.snapshot()).toEqual(state);
    expect(sim.voxels.data).toEqual(blocks);
    for (let i = 0; i < 60; i++) t.stepIdle();
    expect(sim.snapshot()).toEqual(state);
    for (let i = 0; i < 180; i++) sim.step(idle(sim.player));
    expect(sim.snapshot()).toEqual(later);
    expect(sim.voxels.data).toEqual(laterBlocks);
  });
  it("supply runners route around a wall added across their normal journey", () => {
    const sim = new Simulation(),
      worker = sim.actors.find((a) => a.id === 2)!;
    for (let x = 16; x < 22; x++)
      for (let y = 5; y < 8; y++) sim.voxels.set(x, y, 28, Block.Stone);
    let collected = false;
    for (let i = 0; i < 1500; i++) {
      sim.step(idle(sim.player));
      collected ||= worker.cargo > 0;
    }
    expect(collected).toBe(true);
    expect(sim.jobs[0].index).toBeGreaterThan(0);
    for (let x = 16; x < 22; x++)
      expect(sim.voxels.get(x, 5, 28)).toBe(Block.Stone);
  });
});
