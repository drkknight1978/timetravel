import { describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { actor, Block, idle, WorkerTask, type Actor } from "../src/model";
import type {
  AIAction,
  AIResponse,
  AIStatus,
  AILayer,
  NpcIntent,
} from "../src/ai-contract";
import { activeIntent, observeNPCs } from "../src/intelligence";
import { advance, History } from "../src/history";
import { intersectingBlocks } from "../src/physics";
import { Simulation } from "../src/simulation";
import { Temporal } from "../src/temporal";
import { Voxels } from "../src/world";

const status: AIStatus = {
  jev: { configured: true, available: true, calls: 0, limit: 120, reason: "" },
  openai: {
    configured: true,
    available: true,
    calls: 0,
    limit: 20,
    reason: "",
  },
  model: "test-model",
  estimatedCostUsd: 0,
};
function fixture(worker = false) {
  const voxels = new Voxels();
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) voxels.set(x, 0, z, Block.Bedrock, false);
  const sim = new Simulation(voxels);
  const enemy = actor(10, "enemy", 35.5, 1, 16.5);
  sim.actors = [actor(1, "player", 35.5, 1, 22.5), enemy];
  sim.player.combat = Object.freeze({ ...sim.player.combat!, weapon: 1 });
  if (worker) {
    const a = actor(2, "worker", 31.5, 1, 22.5);
    a.site = 0;
    sim.actors.push(a);
  }
  const history = new History(sim);
  return { sim, history, enemy, temporal: new Temporal(sim, history) };
}
function reply(
  sim: Simulation,
  actorId: number,
  action: AIAction,
  layer: AILayer = "instinct",
): AIResponse {
  return {
    epoch: sim.epoch,
    tick: sim.tick,
    layer,
    source: layer === "instinct" ? "jev" : "openai",
    status,
    decisions: [
      { actorId, action, confidence: 0.9, reason: `Choose ${action}` },
    ],
  };
}
function ticks(sim: Simulation, history: History, count: number) {
  for (let i = 0; i < count; i++) advance(sim, history);
}
function npc(sim: Simulation, id = 10): Actor {
  return sim.actors.find((a) => a.id === id)!;
}
function distance(a: Actor, b: Actor) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// These are deterministic provider decisions, not calls to paid external services.
describe("bounded NPC intelligence", () => {
  it("observes hostile actors as threats and keeps enemy allies separate", () => {
    const { sim, enemy } = fixture(true);
    const observation = (id: number) =>
      observeNPCs(sim).find((o) => o.actorId === id)!;
    expect(observation(enemy.id).threatDistance).toBe(6);
    const ally = actor(11, "enemy", enemy.x + 1, 1, enemy.z);
    sim.actors.push(ally);
    expect(observation(enemy.id)).toMatchObject({
      threatDistance: 6,
      allies: 1,
      targetId: sim.playerId,
    });
    const echo = actor(20, "echo", enemy.x, 1, enemy.z + 3);
    sim.actors.push(echo);
    expect(observation(enemy.id)).toMatchObject({
      threatDistance: 3,
      targetId: echo.id,
    });
    expect(observation(2).threatDistance).toBeCloseTo(7.2);
    echo.combat = Object.freeze({ ...echo.combat!, health: 0 });
    for (let x = 0; x < 64; x++)
      for (let y = 1; y < 4; y++) sim.voxels.set(x, y, 19, Block.Stone, false);
    expect(observation(enemy.id)).toMatchObject({
      threatDistance: 99,
      visible: false,
      allies: 1,
    });
  });

  it("applies accepted decisions only at a fixed simulation step and freezes them for history", () => {
    const { sim, history, enemy } = fixture();
    const response = reply(sim, enemy.id, "hold");
    sim.queueAI(response);
    expect(enemy.instinct).toBeUndefined();
    advance(sim, history);
    expect(enemy.instinct).toMatchObject({
      action: "hold",
      until: 361,
      source: "jev",
      targetId: 1,
    });
    expect(Object.isFrozen(enemy.instinct)).toBe(true);
    response.decisions[0].reason = "A later transport mutation";
    expect(enemy.instinct!.reason).toBe("Choose hold");
  });

  it("turns engagement, two flanks, retreat and holding into different enemy movement", () => {
    const end = new Map<AIAction, Actor>();
    for (const action of [
      "engage",
      "flank_left",
      "flank_right",
      "retreat",
      "hold",
    ] as const) {
      const { sim, history, enemy } = fixture();
      sim.queueAI(reply(sim, enemy.id, action));
      ticks(sim, history, 30);
      end.set(action, { ...enemy });
    }
    expect(end.get("engage")!.z).toBeGreaterThan(17.5);
    expect(end.get("flank_left")!.x).toBeLessThan(34.5);
    expect(end.get("flank_right")!.x).toBeGreaterThan(36.5);
    expect(end.get("retreat")!.z).toBeLessThan(15.5);
    expect(end.get("hold")).toMatchObject({ x: 35.5, z: 16.5 });
  });

  it("makes workers watch an armed visitor, investigate an echo, and flee nearby danger", () => {
    const watch = fixture(true);
    watch.sim.actors = watch.sim.actors.filter((a) => a.kind !== "enemy");
    watch.sim.queueAI(reply(watch.sim, 2, "watch"));
    ticks(watch.sim, watch.history, 30);
    expect(npc(watch.sim, 2)).toMatchObject({ x: 31.5, z: 22.5 });
    expect(npc(watch.sim, 2).yaw).toBeCloseTo(-Math.PI / 2);

    const investigate = fixture(true);
    investigate.sim.actors = investigate.sim.actors.filter(
      (a) => a.kind !== "enemy",
    );
    const echo = actor(20, "echo", 34.5, 1, 24.5);
    investigate.sim.actors.push(echo);
    const before = distance(npc(investigate.sim, 2), echo);
    investigate.sim.queueAI(reply(investigate.sim, 2, "investigate", "plan"));
    ticks(investigate.sim, investigate.history, 30);
    expect(npc(investigate.sim, 2).plan?.targetId).toBe(echo.id);
    expect(distance(npc(investigate.sim, 2), echo)).toBeLessThan(before);

    const flee = fixture(true);
    const start = distance(npc(flee.sim, 2), flee.enemy);
    flee.sim.queueAI(reply(flee.sim, flee.enemy.id, "hold"));
    flee.sim.queueAI(reply(flee.sim, 2, "flee"));
    ticks(flee.sim, flee.history, 30);
    expect(distance(npc(flee.sim, 2), flee.enemy)).toBeGreaterThan(start);
  });

  it("makes a watching worker face a visible enemy before an armed visitor", () => {
    const { sim, history, enemy } = fixture(true);
    const worker = npc(sim, 2);
    sim.queueAI(reply(sim, enemy.id, "hold"));
    sim.queueAI(reply(sim, worker.id, "watch"));
    advance(sim, history);
    expect(worker.yaw).toBeCloseTo(
      Math.atan2(-(enemy.x - worker.x), -(enemy.z - worker.z)),
    );
    expect(worker).toMatchObject({ x: 31.5, z: 22.5 });
    enemy.combat = Object.freeze({ ...enemy.combat!, health: 0 });
    advance(sim, history);
    expect(worker.yaw).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps player work orders above AI instincts", () => {
    const { sim, history } = fixture(true);
    const orders = [...sim.camp.orders];
    orders[0] = { mode: 2, owner: sim.playerId, until: 1000 };
    sim.camp = { ...sim.camp, orders };
    const worker = npc(sim, 2),
      before = distance(worker, sim.player);
    sim.queueAI(reply(sim, worker.id, "flee"));
    ticks(sim, history, 30);
    expect(worker.instinct?.action).toBe("flee");
    expect(worker.task).toBe(WorkerTask.Follow);
    expect(distance(worker, sim.player)).toBeLessThan(before);
  });

  it("keeps AI movement on the collision system when a new wall blocks its intended flank", () => {
    const { sim, history, enemy } = fixture();
    sim.queueAI(reply(sim, enemy.id, "flank_left"));
    advance(sim, history);
    for (let z = 0; z < 64; z++)
      for (let y = 1; y <= 4; y++) sim.voxels.set(34, y, z, Block.Stone, false);
    for (let i = 0; i < 180; i++) {
      advance(sim, history);
      expect(enemy.x).toBeGreaterThanOrEqual(35.29);
      expect(intersectingBlocks(sim.voxels, enemy).size).toBe(0);
    }
    expect(enemy.instinct?.action).toBe("flank_left");
  });

  it("does not skip an attack telegraph even when a new retreat decision arrives", () => {
    const { sim, history, enemy } = fixture();
    sim.player.z = 18.5;
    advance(sim, history);
    expect(enemy.task).toBe(2);
    const strikeAt = enemy.taskUntil;
    sim.queueAI(reply(sim, enemy.id, "retreat"));
    while (sim.tick < strikeAt) advance(sim, history);
    expect(
      sim.effects.some(
        (effect) => effect.actorId === enemy.id && effect.kind === "slash",
      ),
    ).toBe(true);
    expect(sim.player.combat!.health).toBeLessThan(100);
  });

  it("uses a short instinct first, then resumes a still-active longer plan", () => {
    const { sim, enemy } = fixture();
    const plan: NpcIntent = Object.freeze({
      action: "flank_left",
      until: 1800,
      source: "openai",
      reason: "Take the side",
      targetId: 1,
    });
    const instinct: NpcIntent = Object.freeze({
      action: "retreat",
      until: 360,
      source: "jev",
      reason: "Avoid the hit",
      targetId: 1,
    });
    enemy.plan = plan;
    enemy.instinct = instinct;
    expect(activeIntent(enemy, sim.tick)).toBe(instinct);
    expect(activeIntent(enemy, 360)).toBe(plan);
    expect(activeIntent(enemy, 1800)).toBeUndefined();
  });

  it.each([
    [
      "unknown actor",
      (r: AIResponse) => {
        r.decisions[0].actorId = 999;
      },
    ],
    [
      "unavailable action",
      (r: AIResponse) => {
        r.decisions[0].action = "flee";
      },
    ],
    [
      "low confidence",
      (r: AIResponse) => {
        r.decisions[0].confidence = 0.59;
      },
    ],
    [
      "invalid confidence",
      (r: AIResponse) => {
        r.decisions[0].confidence = Number.NaN;
      },
    ],
    [
      "confidence above one",
      (r: AIResponse) => {
        r.decisions[0].confidence = 1.1;
      },
    ],
    [
      "missing confidence",
      (r: AIResponse) => {
        r.decisions[0].confidence = undefined;
      },
    ],
    [
      "stale tick",
      (r: AIResponse) => {
        r.tick -= 301;
      },
    ],
    [
      "future tick",
      (r: AIResponse) => {
        r.tick += 100;
      },
    ],
    [
      "invalid tick",
      (r: AIResponse) => {
        r.tick = Number.NaN;
      },
    ],
    [
      "fractional tick",
      (r: AIResponse) => {
        r.tick = 0.5;
      },
    ],
    [
      "different epoch",
      (r: AIResponse) => {
        r.epoch++;
      },
    ],
    [
      "wrong provider",
      (r: AIResponse) => {
        r.source = "openai";
      },
    ],
    [
      "oversized reason",
      (r: AIResponse) => {
        r.decisions[0].reason = "a".repeat(97);
      },
    ],
  ] as const)("ignores %s responses", (_name, invalidate) => {
    const { sim, history, enemy } = fixture();
    const response = reply(sim, enemy.id, "retreat");
    invalidate(response);
    sim.queueAI(response);
    advance(sim, history);
    expect(enemy.instinct).toBeUndefined();
    expect(enemy.plan).toBeUndefined();
  });

  it("revalidates replies against deaths and changed visibility before applying them", () => {
    for (const change of ["death", "wall"] as const) {
      const { sim, history, enemy } = fixture();
      sim.queueAI(reply(sim, enemy.id, "flank_left"));
      if (change === "death")
        enemy.combat = Object.freeze({ ...enemy.combat!, health: 0 });
      else
        for (let y = 1; y <= 4; y++)
          sim.voxels.set(35, y, 19, Block.Stone, false);
      advance(sim, history);
      expect(enemy.instinct).toBeUndefined();
    }
  });

  it("does not send or apply NPC choices to players, echoes or animals", () => {
    const { sim, history } = fixture();
    const echo = actor(20, "echo", 40.5, 1, 22.5),
      animal = actor(6, "animal", 41.5, 1, 22.5);
    animal.site = 0;
    animal.taskUntil = 10000;
    sim.actors.push(echo, animal);
    const response = reply(sim, sim.playerId, "retreat");
    response.decisions.push(
      {
        actorId: echo.id,
        action: "retreat",
        reason: "No borrowing",
        confidence: 1,
      },
      {
        actorId: animal.id,
        action: "retreat",
        reason: "Not an NPC in this layer",
        confidence: 1,
      },
    );
    expect(
      observeNPCs(sim).every((o) => o.kind === "worker" || o.kind === "enemy"),
    ).toBe(true);
    sim.queueAI(response);
    advance(sim, history);
    for (const a of [sim.player, echo, animal]) {
      expect(a.instinct).toBeUndefined();
      expect(a.plan).toBeUndefined();
    }
  });
});

describe("intelligence follows the selected history", () => {
  it("restores immutable intentions and reproduces their subsequent movement exactly", () => {
    const { sim, history, enemy } = fixture();
    sim.queueAI(reply(sim, enemy.id, "flank_left", "plan"));
    advance(sim, history);
    const start = sim.snapshot(),
      blocks = sim.voxels.data.slice();
    const plan = enemy.plan;
    ticks(sim, history, 70);
    const end = sim.snapshot();
    expect(history.frames.get(1)!.intents).toBe(history.frames.get(2)!.intents);
    history.seek(1);
    expect(sim.snapshot()).toEqual(start);
    expect(npc(sim).plan).toBe(plan);
    expect(Object.isFrozen(npc(sim).plan)).toBe(true);
    for (let i = 0; i < 70; i++) sim.step(idle(sim.player));
    expect(sim.snapshot()).toEqual(end);
    expect(sim.voxels.data).toEqual(blocks);
  });

  it("keeps frozen intentions unchanged through preview and restores the original recording on cancel", () => {
    const { sim, history, enemy, temporal } = fixture();
    sim.queueAI(reply(sim, enemy.id, "hold", "plan"));
    ticks(sim, history, 20);
    const early = sim.snapshot();
    sim.queueAI(reply(sim, enemy.id, "retreat"));
    ticks(sim, history, 20);
    const present = sim.snapshot();
    temporal.enter();
    temporal.seek(20);
    for (let i = 0; i < 60; i++)
      temporal.update({ ...idle(temporal.view), mx: 1 });
    expect(sim.snapshot()).toEqual(early);
    temporal.seek(40);
    expect(sim.snapshot()).toEqual(present);
    temporal.seek(20);
    temporal.cancel();
    expect(sim.snapshot()).toEqual(present);
  });

  it("drops queued and late future decisions after a branch and does not give them to the new player", () => {
    const { sim, history, enemy, temporal } = fixture();
    sim.queueAI(reply(sim, enemy.id, "hold", "plan"));
    ticks(sim, history, 20);
    const oldPlan = enemy.plan;
    ticks(sim, history, 20);
    const abandoned = reply(sim, enemy.id, "retreat");
    sim.queueAI(abandoned);
    temporal.enter();
    temporal.seek(20);
    temporal.traveller.x += 4;
    expect(temporal.resume().ok).toBe(true);
    sim.queueAI(abandoned);
    ticks(sim, history, 5);
    expect(npc(sim).plan).toBe(oldPlan);
    expect(npc(sim).instinct).toBeUndefined();
    expect(sim.player.instinct).toBeUndefined();
    expect(sim.actors.find((a) => a.kind === "echo")!.instinct).toBeUndefined();
    expect(history.latest).toBe(25);
  });

  it("bounds five-minute history with changing intentions on seven NPCs and three full replay scripts", () => {
    setFlagsFromString("--expose_gc");
    const gc = runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage();
    const sim = new Simulation();
    Object.assign(sim.player, { x: 30.5, y: 5, z: 29.5 });
    for (let i = 0; i < 3; i++) {
      const replay = sim.createReplay(
        Array.from({ length: 18000 }, () => idle(sim.player)),
      );
      const echo = actor(sim.nextId++, "echo", 15 + i * 3, 5, 38);
      echo.program = replay.id;
      sim.actors.push(echo);
    }
    const history = new History(sim);
    let decisions = 0;
    for (let tick = 0; tick < 18240; tick++) {
      if (tick % 300 === 0) {
        const observations = observeNPCs(sim);
        expect(observations).toHaveLength(7);
        const response = reply(sim, 2, "routine");
        response.decisions = observations.map((o) => ({
          actorId: o.actorId,
          action: "routine",
          reason: `Routine at recorded tick ${tick}`,
          confidence: 0.95,
        }));
        decisions += response.decisions.length;
        sim.queueAI(response);
        if (tick % 1800 === 0)
          sim.queueAI({ ...response, layer: "plan", source: "openai" });
      }
      advance(sim, history);
    }
    const bytes = history.bytes();
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
        benchmark: "five-minute AI history, seven NPCs, three replay scripts",
        decisions,
        estimatedMiB: +(bytes / 1048576).toFixed(2),
        retainedMiB: +retainedMiB.toFixed(2),
        frames: history.frames.size,
      }),
    );
    expect(history.frames.size).toBe(18001);
    expect(bytes).toBeLessThan(64 * 1048576);
    expect(retainedMiB).toBeLessThan(64);
    const final = sim.snapshot();
    history.seek(history.oldest);
    history.seek(history.latest);
    expect(sim.snapshot()).toEqual(final);
  }, 20000);
});
