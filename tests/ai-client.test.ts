import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligenceClient } from "../src/ai-client";
import type {
  AIRequest,
  AIResponse,
  AIStatus,
  NPCObservation,
} from "../src/ai-contract";
import type { Simulation } from "../src/simulation";
import type { Temporal } from "../src/temporal";

vi.mock("../src/intelligence", () => ({
  observeNPCs: (sim: { observations: NPCObservation[] }) => sim.observations,
}));

const observation = (actorId = 2): NPCObservation => ({
  actorId,
  kind: "worker",
  role: 0,
  health: 100,
  position: { x: 10, y: 5, z: 10 },
  targetId: 1,
  targetDistance: 3,
  threatDistance: 99,
  visible: true,
  blocked: false,
  allies: 1,
  playerArmed: true,
  playerHealth: 100,
  echoes: 0,
  currentAction: "routine",
  options: ["routine", "watch", "investigate"],
});
function status(jev = true, openai = false): AIStatus {
  return {
    jev: {
      configured: jev,
      available: jev,
      calls: 0,
      limit: 120,
      reason: jev ? "ready" : "not_configured",
    },
    openai: {
      configured: openai,
      available: openai,
      calls: 0,
      limit: 40,
      reason: openai ? "ready" : "not_configured",
    },
    model: "gpt-4.1-nano",
    estimatedCostUsd: 0,
  };
}
const json = (data: unknown) =>
  Promise.resolve({ ok: true, json: async () => data } as Response);
const reply = (request: AIRequest, availability = status()): AIResponse => ({
  epoch: request.epoch,
  tick: request.tick,
  layer: request.layer,
  source: request.layer === "instinct" ? "jev" : "openai",
  decisions: request.npcs.map((npc) => ({
    actorId: npc.actorId,
    action: "watch",
    reason: "Watch the armed visitor.",
    confidence: 0.9,
  })),
  status: availability,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function setup(availability = status()) {
  const sim = {
    epoch: 0,
    tick: 0,
    observations: [observation()],
    queueAI: vi.fn(),
    clearQueuedAI: vi.fn(),
  };
  const temporal = { mode: "live" as "live" | "temporal" };
  let milliseconds = 0;
  let answer: (request: AIRequest) => Promise<Response> = (request) =>
    json(reply(request, availability));
  const requests: AIRequest[] = [];
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn(
    (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      signals.push(init!.signal as AbortSignal);
      if (String(url).endsWith("/status")) return json(availability);
      const request = JSON.parse(String(init!.body)) as AIRequest;
      requests.push(request);
      return answer(request);
    },
  );
  const client = new IntelligenceClient(
    sim as unknown as Simulation,
    temporal as Temporal,
    fetcher as typeof fetch,
    () => milliseconds,
  );
  return {
    sim,
    temporal,
    client,
    requests,
    signals,
    fetcher,
    time: (value: number) => {
      milliseconds = value;
    },
    answer: (fn: typeof answer) => {
      answer = fn;
    },
    async start() {
      client.update(true);
      await flush();
      client.update(true);
      await flush();
    },
  };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("NPC intelligence scheduling", () => {
  it("fetches only relative local endpoints and queues a validated choice without stepping the world", async () => {
    const h = setup();
    h.client.update(true);
    expect(h.sim.queueAI).not.toHaveBeenCalled();
    await flush();
    h.client.update(true);
    expect(h.sim.queueAI).not.toHaveBeenCalled();
    await flush();
    expect(h.sim.tick).toBe(0);
    expect(h.sim.queueAI).toHaveBeenCalledOnce();
    expect(h.sim.queueAI.mock.calls[0][0].decisions[0].action).toBe("watch");
    expect(h.fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/npc-ai/status",
      "/api/npc-ai/decide",
    ]);
    expect(JSON.stringify(h.requests)).not.toMatch(/API_KEY|Bearer/);
    expect(h.client.lastMessage).toBe("Jev reactions · rule-based planning");
  });

  it("invokes fetch without binding the client as its receiver", async () => {
    const h = setup();
    let receiver: unknown = "not called";
    const fetcher = function (this: unknown): Promise<Response> {
      receiver = this;
      return json(status());
    };
    const client = new IntelligenceClient(
      h.sim as unknown as Simulation,
      h.temporal as Temporal,
      fetcher as typeof fetch,
      () => 0,
    );
    client.update(true);
    await flush();
    expect(receiver).toBeUndefined();
    expect(client.status?.jev.available).toBe(true);
  });

  it("bounds instinct calls by both wall time and simulation ticks even at high frame rates", async () => {
    const h = setup();
    await h.start();
    for (let i = 0; i < 1_000; i++) h.client.update(true);
    expect(h.requests).toHaveLength(1);
    h.time(5_000);
    h.sim.tick = 299;
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(1);
    h.sim.tick = 300;
    h.time(4_999);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(1);
    h.time(5_000);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    h.sim.tick = 900;
    h.time(9_999);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
  });

  it("bounds planning separately and supports OpenAI without a Jev key", async () => {
    const h = setup(status(false, true));
    await h.start();
    expect(h.requests.map((r) => r.layer)).toEqual(["plan"]);
    h.time(30_000);
    h.sim.tick = 1_799;
    h.client.update(true);
    await flush();
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(1);
    h.sim.tick = 1_800;
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.client.lastMessage).toBe("Rule-based reactions · nano planning");
  });

  it("sends both layers in separate bounded batches and never overlaps requests", async () => {
    const h = setup(status(true, true));
    h.sim.observations = Array.from({ length: 12 }, (_, i) =>
      observation(i + 2),
    );
    const pending = deferred<Response>();
    h.answer(() => pending.promise);
    await h.start();
    h.client.update(true);
    h.client.update(true);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].npcs).toHaveLength(7);
    pending.resolve(await json(reply(h.requests[0], status(true, true))));
    await flush();
    h.answer((request) => json(reply(request, status(true, true))));
    h.client.update(true);
    await flush();
    expect(h.requests.map((r) => r.layer)).toEqual(["instinct", "plan"]);
  });

  it("does not spend a call when nobody nearby has a meaningful choice", async () => {
    const h = setup();
    h.sim.observations = [];
    await h.start();
    h.sim.observations = [{ ...observation(), options: ["routine"] }];
    h.client.update(true);
    await flush();
    expect(h.requests).toEqual([]);
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("refreshes missing-key status at most every thirty seconds without paid requests", async () => {
    const h = setup(status(false, false));
    await h.start();
    for (let i = 0; i < 1_000; i++) h.client.update(true);
    expect(h.fetcher).toHaveBeenCalledOnce();
    h.time(30_000);
    h.client.update(true);
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.requests).toEqual([]);
    expect(h.client.lastMessage).toContain("AI keys not configured");
  });

  it("recognises a normal provider rate limit as a cooldown, not a permanent failure", async () => {
    const h = setup();
    const cooling = status();
    cooling.jev.available = false;
    cooling.jev.reason = "rate_limited";
    h.answer((request) => json(reply(request, cooling)));
    await h.start();
    h.time(5_000);
    h.sim.tick = 300;
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.client.lastMessage).toContain("Jev reactions");
  });

  it("retries low-confidence abstentions at the normal cadence without outage backoff", async () => {
    const h = setup();
    const uncertain = status();
    uncertain.jev.available = false;
    uncertain.jev.reason = "low_confidence";
    h.answer((request) =>
      json({ ...reply(request, uncertain), source: "rules", decisions: [] }),
    );
    await h.start();
    expect(h.sim.queueAI).not.toHaveBeenCalled();
    expect(h.client.lastMessage).toContain("Jev reactions");
    expect(h.client.lastMessage).not.toContain("retrying");
    h.time(4_999);
    h.sim.tick = 300;
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(1);
    h.answer((request) => json(reply(request)));
    h.time(5_000);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.sim.queueAI).toHaveBeenCalledOnce();
  });

  it.each(["jev", "openai"] as const)(
    "shows a rejected %s key while the other provider still works",
    async (rejected) => {
      const availability = status(true, true);
      availability[rejected].available = false;
      availability[rejected].reason = "authentication_failed";
      const h = setup(availability);
      await h.start();
      expect(h.requests.map((request) => request.layer)).toEqual([
        rejected === "jev" ? "plan" : "instinct",
      ]);
      expect(h.client.lastMessage).toContain(
        rejected === "jev" ? "nano planning" : "Jev reactions",
      );
      expect(h.client.lastMessage).toContain(
        rejected === "jev" ? "Jev key rejected" : "OpenAI key rejected",
      );
      expect(h.client.lastMessage).not.toContain("retrying");
      h.client.update(true);
      await flush();
      expect(h.requests).toHaveLength(1);
    },
  );

  it("does not retry a rejected key and describes the issue instead of a temporary outage", async () => {
    const availability = status(false, true);
    availability.openai.available = false;
    availability.openai.reason = "authentication_failed";
    const h = setup(availability);
    await h.start();
    expect(h.client.lastMessage).toBe("Rules only · OpenAI key rejected");
    h.time(30_000);
    h.sim.tick = 1_800;
    h.client.update(true);
    await flush();
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it("never calls an exhausted provider even if its status says available", async () => {
    const availability = status();
    availability.jev.calls = availability.jev.limit;
    const h = setup(availability);
    await h.start();
    expect(h.requests).toEqual([]);
    expect(h.client.lastMessage).toContain("session AI budget reached");
  });
});

describe("timeline-safe asynchronous replies", () => {
  it.each(["freeze", "cancel", "branch", "pause", "disable"] as const)(
    "discards a delayed reply after %s",
    async (transition) => {
      const h = setup(),
        pending = deferred<Response>();
      h.answer(() => pending.promise);
      await h.start();
      const request = h.requests[0];
      if (transition === "freeze") h.temporal.mode = "temporal";
      if (transition === "cancel") {
        h.client.invalidate();
        h.temporal.mode = "temporal";
        h.client.update(false);
        h.temporal.mode = "live";
        h.client.update(true);
      }
      if (transition === "branch") {
        h.sim.epoch++;
        h.sim.tick = 0;
      }
      if (transition === "pause") h.client.update(false);
      if (transition === "disable") h.client.setEnabled(false);
      pending.resolve(await json(reply(request)));
      await flush();
      expect(h.sim.queueAI).not.toHaveBeenCalled();
    },
  );

  it("aborts on pause and clears only queued answers, preserving existing actor decisions", async () => {
    const h = setup(),
      pending = deferred<Response>();
    h.answer(() => pending.promise);
    await h.start();
    h.client.update(false);
    expect(h.signals[1].aborted).toBe(true);
    expect(h.sim.clearQueuedAI).toHaveBeenCalledOnce();
    pending.resolve(await json(reply(h.requests[0])));
    await flush();
    expect(h.sim.queueAI).not.toHaveBeenCalled();
  });

  it("does not let a restored earlier tick block new requests until the abandoned future", async () => {
    const h = setup();
    h.sim.tick = 10_000;
    await h.start();
    h.sim.epoch++;
    h.sim.tick = 30;
    h.time(5_000);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].epoch).toBe(1);
    expect(h.requests[1].tick).toBe(30);
  });

  it("drops answers that have become too old in simulation time", async () => {
    const h = setup(),
      pending = deferred<Response>();
    h.answer(() => pending.promise);
    await h.start();
    h.sim.tick = 301;
    pending.resolve(await json(reply(h.requests[0])));
    await flush();
    expect(h.sim.queueAI).not.toHaveBeenCalled();
  });

  it("cannot bypass rate limits by repeatedly toggling AI", async () => {
    const h = setup();
    await h.start();
    for (let i = 0; i < 20; i++) {
      h.client.setEnabled(false);
      h.client.setEnabled(true);
      h.client.update(true);
    }
    await flush();
    expect(h.requests).toHaveLength(1);
  });
});

describe("untrusted response validation and fallback", () => {
  const invalid: [string, (r: AIResponse) => unknown][] = [
    [
      "low confidence",
      (r) => {
        r.decisions[0].confidence = 0.59;
        return r;
      },
    ],
    [
      "non-finite confidence",
      (r) => {
        r.decisions[0].confidence = NaN;
        return r;
      },
    ],
    [
      "missing confidence",
      (r) => {
        delete r.decisions[0].confidence;
        return r;
      },
    ],
    [
      "unknown actor",
      (r) => {
        r.decisions[0].actorId = 999;
        return r;
      },
    ],
    [
      "unoffered action",
      (r) => {
        r.decisions[0].action = "engage";
        return r;
      },
    ],
    [
      "long reason",
      (r) => {
        r.decisions[0].reason = "x".repeat(97);
        return r;
      },
    ],
    [
      "wrong source",
      (r) => {
        r.source = "openai";
        return r;
      },
    ],
    [
      "wrong layer",
      (r) => {
        r.layer = "plan";
        return r;
      },
    ],
    [
      "wrong tick",
      (r) => {
        r.tick++;
        return r;
      },
    ],
    [
      "wrong epoch",
      (r) => {
        r.epoch++;
        return r;
      },
    ],
    ["malformed payload", () => "not a response"],
  ];
  it.each(invalid)(
    "rejects %s and keeps local rules running",
    async (_, corrupt) => {
      const h = setup();
      h.answer((request) => json(corrupt(reply(request))));
      await h.start();
      expect(h.sim.queueAI).not.toHaveBeenCalled();
      expect(h.client.lastMessage).toContain("Rules only");
    },
  );

  it("backs off after an outage then resumes when the local service recovers", async () => {
    const h = setup();
    h.answer(async () => {
      throw new Error("network lost");
    });
    await h.start();
    h.sim.tick = 1_500;
    h.time(25_000);
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(1);
    h.answer((request) => json(reply(request)));
    h.time(30_000);
    h.sim.tick = 1_800;
    h.client.update(true);
    await flush();
    h.client.update(true);
    await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.sim.queueAI).toHaveBeenCalledOnce();
  });

  it("times out instinct requests and aborts the transport without stepping simulation", async () => {
    const h = setup();
    h.answer(() => new Promise(() => {}));
    await h.start();
    await vi.advanceTimersByTimeAsync(3_500);
    expect(h.signals[1].aborted).toBe(true);
    expect(h.sim.tick).toBe(0);
    expect(h.sim.queueAI).not.toHaveBeenCalled();
    expect(h.client.lastMessage).toContain("Rules only");
  });

  it("accepts an explicit rules fallback without queuing model actions", async () => {
    const h = setup();
    h.answer((request) =>
      json({ ...reply(request), source: "rules", decisions: [] }),
    );
    await h.start();
    expect(h.sim.queueAI).not.toHaveBeenCalled();
  });
});
