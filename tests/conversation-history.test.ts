import { describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { advance, History } from "../src/history";
import { actor, Block, bodyHeight, idle } from "../src/model";
import { Simulation } from "../src/simulation";
import { Temporal } from "../src/temporal";
import { Voxels } from "../src/world";
import {
  MAX_EXCHANGES,
  MAX_MESSAGE,
  MAX_REPLY,
  MAX_SESSION_EXCHANGES,
  type ConversationBatch,
  type ConversationTurn,
} from "../src/conversation-contract";

function fixture(window = 18000) {
  const voxels = new Voxels();
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) voxels.set(x, 0, z, Block.Bedrock, false);
  const sim = new Simulation(voxels);
  sim.actors = [
    actor(1, "player", 10.5, 1, 10.5),
    actor(2, "worker", 12.5, 1, 10.5),
    actor(3, "worker", 10.5, 1, 12.5),
  ];
  sim.actors[1].site = 0;
  sim.actors[2].site = 0;
  // Keep workers still so tests isolate conversation reach and restoration.
  sim.camp = {
    ...sim.camp,
    orders: sim.camp.orders.map(() => ({ mode: 1, owner: 1, until: 1e9 })),
  };
  const history = new History(sim, window);
  return { sim, history, temporal: new Temporal(sim, history) };
}
function batch(
  sim: Simulation,
  messages = ["Hello"],
  npcId = 2,
): ConversationBatch {
  return {
    epoch: sim.epoch,
    tick: sim.tick,
    playerId: sim.playerId,
    npcId,
    turns: messages.map((player) => ({
      player,
      npc: `I heard you say: ${player}`,
      source: "local",
      tick: sim.tick,
      playerId: sim.playerId,
    })),
  };
}
function commit(
  sim: Simulation,
  history: History,
  messages = ["Hello"],
  npcId = 2,
) {
  sim.queueConversation(batch(sim, messages, npcId));
  advance(sim, history);
  return sim.camp.conversations[npcId];
}
function ticks(sim: Simulation, history: History, count: number) {
  for (let i = 0; i < count; i++) advance(sim, history);
}

describe("rewindable NPC conversations", () => {
  it("commits completed dialogue on the next fixed tick without changing a paused snapshot", () => {
    const { sim, history } = fixture();
    const before = sim.snapshot();
    const beforeFrame = history.frames.get(0)!;
    const dialogue = batch(sim, ["Please follow me and give me a lantern"]);
    sim.queueConversation(dialogue);
    expect(sim.hasQueuedConversation).toBe(true);
    expect(sim.snapshot()).toEqual(before);
    expect(history.frames.get(0)).toBe(beforeFrame);
    expect(sim.camp.conversations).toEqual({});
    advance(sim, history);
    const memory = sim.camp.conversations[2];
    expect(sim.hasQueuedConversation).toBe(false);
    expect(memory).toEqual([{ ...dialogue.turns[0], tick: 1 }]);
    expect(Object.isFrozen(sim.camp.conversations)).toBe(true);
    expect(Object.isFrozen(memory)).toBe(true);
    expect(Object.isFrozen(memory[0])).toBe(true);
    expect(sim.camp.bag).toBe(before.camp.bag);
    expect(sim.camp.orders).toBe(before.camp.orders);
    expect(sim.camp.requests).toBe(before.camp.requests);
    expect(history.frames.get(0)!.camp.conversations).toEqual({});
    expect(history.script(1, 0, 1)[0].action).toBeUndefined();
  });

  it("copies queued text so UI mutation cannot alter past conversations", () => {
    const { sim, history } = fixture();
    const pending = batch(sim);
    sim.queueConversation(pending);
    const mutable = pending.turns as unknown as {
      player: string;
      npc: string;
    }[];
    mutable[0].player = "mutated";
    mutable.push({ player: "unexpected", npc: "unexpected" });
    advance(sim, history);
    expect(sim.camp.conversations[2]).toHaveLength(1);
    expect(sim.camp.conversations[2][0].player).toBe("Hello");
  });

  it("keeps the last six exchanges per NPC while preserving older snapshots", () => {
    const { sim, history } = fixture();
    const first = commit(sim, history, ["one", "two", "three"]);
    const other = commit(sim, history, ["hello Ash"], 3);
    const latest = commit(sim, history, ["four", "five", "six", "seven"]);
    expect(latest).toHaveLength(MAX_EXCHANGES);
    expect(latest.map((turn) => turn.player)).toEqual([
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
    ]);
    expect(first.map((turn) => turn.player)).toEqual(["one", "two", "three"]);
    expect(history.frames.get(1)!.camp.conversations[2]).toBe(first);
    expect(sim.camp.conversations[3]).toBe(other);
  });

  it("records the last six turns of a long paused session at the resume tick", () => {
    const { sim, history } = fixture();
    const messages = Array.from(
      { length: MAX_SESSION_EXCHANGES },
      (_, i) => `Question ${i}`,
    );
    const memory = commit(sim, history, messages);
    expect(memory).toHaveLength(6);
    expect(memory[0].player).toBe("Question 6");
    expect(memory.every((turn) => turn.tick === 1 && turn.playerId === 1)).toBe(
      true,
    );
  });

  it("rewinds, previews forward, and cancels with exact NPC memories", () => {
    const { sim, history, temporal } = fixture();
    commit(sim, history, ["Earlier conversation"]);
    ticks(sim, history, 2);
    const earlier = sim.camp;
    commit(sim, history, ["Later conversation"]);
    ticks(sim, history, 2);
    const present = sim.snapshot();
    temporal.enter();
    temporal.seek(0);
    expect(sim.camp.conversations).toEqual({});
    temporal.seek(3);
    expect(sim.camp).toBe(earlier);
    temporal.seek(6);
    expect(sim.snapshot()).toEqual(present);
    temporal.seek(0);
    temporal.cancel();
    expect(sim.snapshot()).toEqual(present);
  });

  it("keeps earlier memories across a branch but never replays abandoned dialogue through a past self", () => {
    const { sim, history, temporal } = fixture();
    const older = commit(sim, history, ["A foundation worth keeping"]);
    ticks(sim, history, 2);
    commit(sim, history, ["An abandoned future"]);
    ticks(sim, history, 4);
    temporal.enter();
    temporal.seek(1);
    temporal.traveller.x = 8.5;
    const result = temporal.resume();
    expect(result).toMatchObject({ ok: true, branched: true });
    expect(sim.camp.conversations[2]).toBe(older);
    expect(sim.playerId).not.toBe(1);
    expect(older[0].playerId).toBe(1);
    ticks(sim, history, 8);
    expect(sim.camp.conversations[2]).toBe(older);
    expect(
      Object.values(sim.camp.conversations)
        .flat()
        .some((turn) => turn.player.includes("abandoned")),
    ).toBe(false);
    expect(history.frames.get(4)!.camp.conversations[2]).toBe(older);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    expect(echo.cursor).toBe(7);
    expect(
      sim.replays
        .get(echo.program)!
        .commands.every((command) => !command.action),
    ).toBe(true);
  });

  it("clears queued dialogue on restoration and rejects late responses from another epoch", () => {
    const { sim, history } = fixture();
    const pending = batch(sim);
    sim.queueConversation(pending);
    history.seek(0);
    expect(sim.hasQueuedConversation).toBe(false);
    sim.queueConversation(pending);
    advance(sim, history);
    expect(sim.camp.conversations).toEqual({});
  });

  it("rejects a conversation from a previous player incarnation", () => {
    const { sim, history, temporal } = fixture();
    const pending = batch(sim);
    ticks(sim, history, 2);
    temporal.enter();
    temporal.seek(0);
    temporal.traveller.x = 8.5;
    expect(temporal.resume().ok).toBe(true);
    sim.queueConversation({ ...pending, epoch: sim.epoch });
    advance(sim, history);
    expect(sim.camp.conversations).toEqual({});
  });

  it("commits at the same edge of conversation reach used by the panel", () => {
    const { sim, history } = fixture();
    const npc = sim.actors[1];
    npc.x = sim.player.x + 3.16;
    expect(
      sim.canReach(sim.player, { ...npc, y: npc.y + bodyHeight(npc) * 0.65 }),
    ).toBe(true);
    expect(sim.canReach(sim.player, { ...npc, y: npc.y + 1 })).toBe(false);
    commit(sim, history, ["A question from the edge of reach"]);
    expect(sim.camp.conversations[2][0].player).toBe(
      "A question from the edge of reach",
    );
  });

  it("accepts only one completed batch per world tick", () => {
    const { sim, history } = fixture();
    sim.queueConversation(batch(sim, ["first"]));
    sim.queueConversation(batch(sim, ["second"]));
    // The caller uses this signal to defer reopening a conversation until commit.
    expect(sim.hasQueuedConversation).toBe(true);
    advance(sim, history);
    expect(sim.hasQueuedConversation).toBe(false);
    expect(sim.camp.conversations[2].map((turn) => turn.player)).toEqual([
      "first",
    ]);
  });

  it.each([
    "distant",
    "wall",
    "dead NPC",
    "dead player",
    "not a worker",
    "missing NPC",
  ])("rechecks %s before committing a queued exchange", (condition) => {
    const { sim, history } = fixture();
    sim.queueConversation(batch(sim));
    const npc = sim.actors[1];
    if (condition === "distant") npc.x += 20;
    if (condition === "wall")
      for (let y = 1; y < 4; y++) sim.voxels.set(11, y, 10, Block.Stone, false);
    if (condition === "dead NPC")
      npc.combat = { ...sim.player.combat!, health: 0 };
    if (condition === "dead player")
      sim.player.combat = { ...sim.player.combat!, health: 0 };
    if (condition === "not a worker") npc.kind = "echo";
    if (condition === "missing NPC")
      sim.actors = sim.actors.filter((a) => a !== npc);
    advance(sim, history);
    expect(sim.camp.conversations).toEqual({});
  });

  it("ignores malformed or sparse batches without throwing", () => {
    const { sim, history } = fixture();
    for (const value of [
      null,
      undefined,
      0,
      "bad",
      {},
      { ...batch(sim), turns: Array(2) },
    ])
      expect(() =>
        sim.queueConversation(value as ConversationBatch),
      ).not.toThrow();
    expect(sim.hasQueuedConversation).toBe(false);
    advance(sim, history);
    expect(sim.camp.conversations).toEqual({});
  });

  const invalidCases: [string, (value: ConversationBatch) => unknown][] = [
    ["empty batch", (value) => ({ ...value, turns: [] })],
    [
      "oversized batch",
      (value) => ({
        ...value,
        turns: Array.from(
          { length: MAX_SESSION_EXCHANGES + 1 },
          () => value.turns[0],
        ),
      }),
    ],
    ["missing turns", (value) => ({ ...value, turns: null })],
    [
      "unknown source",
      (value) => ({
        ...value,
        turns: [{ ...value.turns[0], source: "unknown" }],
      }),
    ],
    [
      "empty player text",
      (value) => ({ ...value, turns: [{ ...value.turns[0], player: "   " }] }),
    ],
    [
      "empty NPC text",
      (value) => ({ ...value, turns: [{ ...value.turns[0], npc: "" }] }),
    ],
    [
      "long player text",
      (value) => ({
        ...value,
        turns: [{ ...value.turns[0], player: "p".repeat(MAX_MESSAGE + 1) }],
      }),
    ],
    [
      "long NPC text",
      (value) => ({
        ...value,
        turns: [{ ...value.turns[0], npc: "n".repeat(MAX_REPLY + 1) }],
      }),
    ],
    [
      "nontext reply",
      (value) => ({ ...value, turns: [{ ...value.turns[0], npc: {} }] }),
    ],
    [
      "mismatched turn time",
      (value) => ({
        ...value,
        turns: [{ ...value.turns[0], tick: value.tick + 1 }],
      }),
    ],
    [
      "mismatched turn player",
      (value) => ({ ...value, turns: [{ ...value.turns[0], playerId: 999 }] }),
    ],
    ["past request tick", (value) => ({ ...value, tick: value.tick - 1 })],
    ["future request tick", (value) => ({ ...value, tick: value.tick + 1 })],
    ["nonfinite tick", (value) => ({ ...value, tick: NaN })],
    ["wrong epoch", (value) => ({ ...value, epoch: value.epoch + 1 })],
    ["invalid NPC identity", (value) => ({ ...value, npcId: 2.5 })],
  ];
  it.each(invalidCases)(
    "rejects %s without touching history",
    (_name, change) => {
      const { sim, history } = fixture();
      sim.queueConversation(change(batch(sim)) as ConversationBatch);
      advance(sim, history);
      expect(sim.camp.conversations).toEqual({});
    },
  );

  it("shares dialogue across idle frames and releases old memories with history eviction", () => {
    const { sim, history } = fixture(120);
    const before = history.bytes();
    const longText = "A".repeat(MAX_MESSAGE);
    const turns: ConversationTurn[] = Array.from(
      { length: MAX_EXCHANGES },
      () => ({
        player: longText,
        npc: "B".repeat(MAX_REPLY),
        source: "openai",
        tick: 0,
        playerId: 1,
      }),
    );
    sim.queueConversation({ ...batch(sim), turns });
    advance(sim, history);
    const memory = sim.camp.conversations;
    const afterTalk = history.bytes();
    ticks(sim, history, 300);
    expect(history.frames.size).toBeLessThanOrEqual(241);
    for (const frame of history.frames.values())
      expect(frame.camp.conversations).toBe(memory);
    expect(afterTalk - before).toBeGreaterThan(20000);
    // Large strings are counted once, never copied on every frame.
    const dataBudget = history.frames.size * 3000 + 30000;
    expect(history.bytes()).toBeLessThan(dataBudget);
    const firstMemory = sim.camp.conversations[2];
    commit(sim, history, [
      "new one",
      "new two",
      "new three",
      "new four",
      "new five",
      "new six",
    ]);
    ticks(sim, history, 300);
    expect(
      Array.from(history.frames.values()).some(
        (frame) => frame.camp.conversations[2] === firstMemory,
      ),
    ).toBe(false);
    expect(sim.camp.conversations[2]).toHaveLength(6);
    expect(history.bytes()).toBeLessThan(dataBudget);
  });
  it("bounds five-minute history with eighty maximum-length exchanges and three replay scripts", () => {
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
    let conversations = 0;
    for (let tick = 0; tick < 18000; tick++) {
      if (tick % 225 === 0) {
        const npc = sim.actors.find((a) => a.id === 2 + (conversations % 4))!;
        Object.assign(sim.player, {
          x: npc.x + 1.6,
          y: npc.y,
          z: npc.z,
          vy: 0,
        });
        sim.player.combat = Object.freeze({
          ...sim.player.combat!,
          health: 100,
        });
        // A unique prefix prevents coincidentally identical strings understating memory.
        const prefix = `Conversation ${conversations}: `;
        const player = prefix.padEnd(MAX_MESSAGE, "p");
        const reply = prefix.padEnd(MAX_REPLY, "n");
        sim.queueConversation({
          ...batch(sim, [player], npc.id),
          turns: [
            {
              player,
              npc: reply,
              source: "openai",
              tick,
              playerId: sim.playerId,
            },
          ],
        });
        conversations++;
      }
      advance(sim, history);
    }
    const exchanges = new Set<ConversationTurn>();
    for (const frame of history.frames.values())
      for (const memory of Object.values(frame.camp.conversations))
        for (const exchange of memory) exchanges.add(exchange);
    expect(exchanges.size).toBe(80);
    expect(history.frames.size).toBe(18001);
    expect(
      Object.values(sim.camp.conversations).every(
        (memory) => memory.length === 6,
      ),
    ).toBe(true);
    const estimatedMiB = history.bytes() / 1048576;
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
        benchmark:
          "five-minute history, eighty full-length conversations, three replay scripts",
        conversations: exchanges.size,
        estimatedMiB: +estimatedMiB.toFixed(2),
        retainedMiB: +retainedMiB.toFixed(2),
        frames: history.frames.size,
      }),
    );
    expect(estimatedMiB).toBeLessThan(64);
    expect(retainedMiB).toBeLessThan(64);
    const final = sim.snapshot();
    history.seek(0);
    expect(sim.camp.conversations).toEqual({});
    history.seek(history.latest);
    expect(sim.snapshot()).toEqual(final);
  }, 20000);
});
