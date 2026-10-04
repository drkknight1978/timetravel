import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSession } from "../src/conversation-client";
import { Simulation } from "../src/simulation";
import { History, advance } from "../src/history";
import { Temporal } from "../src/temporal";
import {
  type ConversationRequest,
  type ConversationStatus,
} from "../src/conversation-contract";
const availability = (reason = "ready"): ConversationStatus => ({
  configured: true,
  available: reason === "ready",
  calls: 1,
  limit: 80,
  reason,
  model: "gpt-4.1-nano",
  estimatedCostUsd: 0.0001,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const answer = (
  r: ConversationRequest,
  source: "openai" | "local" = "openai",
) => ({
  epoch: r.epoch,
  tick: r.tick,
  npcId: r.npcId,
  playerId: r.playerId,
  reply: "A path should give people a reason to explore. What would you build?",
  source,
  status: availability(source === "openai" ? "ready" : "authentication_failed"),
});
function scene() {
  const sim = new Simulation();
  Object.assign(sim.player, { x: 20.5, y: 5, z: 27.3 });
  const history = new History(sim),
    temporal = new Temporal(sim, history);
  return { sim, history, temporal };
}
function setup(
  handle?: (request: ConversationRequest) => Promise<Response>,
  enabled = () => true,
) {
  const world = scene(),
    requests: ConversationRequest[] = [],
    changed = vi.fn();
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.body) return json(availability());
    const r = JSON.parse(String(init.body)) as ConversationRequest;
    requests.push(r);
    return handle ? handle(r) : json(answer(r));
  }) as unknown as typeof fetch;
  const session = new ConversationSession(
    world.sim,
    world.temporal,
    2,
    changed,
    fetcher,
    enabled,
  );
  return { ...world, session, requests, fetcher, changed };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
describe("written NPC conversation client", () => {
  it("shows a local-service notice when the initial status request times out", async () => {
    vi.useFakeTimers();
    const { sim, temporal } = scene();
    const session = new ConversationSession(
      sim,
      temporal,
      2,
      () => {},
      (() => new Promise(() => {})) as typeof fetch,
    );
    await vi.advanceTimersByTimeAsync(3501);
    expect(session.notice).toContain("unavailable");
    session.dispose();
  });

  it("carries context across multiple messages while the world stays paused, then records on close", async () => {
    const h = setup(),
      before = h.sim.snapshot();
    await h.session.send("What are you building?");
    expect(h.session.messages).toHaveLength(2);
    expect(h.session.messages[1].source).toBe("openai");
    await h.session.send("Could we build a bridge instead?");
    expect(h.requests[1].history[0].player).toBe("What are you building?");
    expect(h.sim.snapshot()).toEqual(before);
    expect(h.sim.camp.conversations[2]).toBeUndefined();
    h.session.dispose();
    h.session.dispose();
    advance(h.sim, h.history);
    expect(h.sim.camp.conversations[2]).toHaveLength(2);
    expect(h.sim.camp.conversations[2][1]).toMatchObject({
      tick: 1,
      playerId: 1,
      source: "openai",
    });
  });
  it("displays remembered exchanges on reopening and forgets them when history is rewound", async () => {
    const h = setup();
    await h.session.send("I would like a bridge.");
    h.session.dispose();
    advance(h.sim, h.history);
    const reopened = new ConversationSession(
      h.sim,
      h.temporal,
      2,
      () => {},
      h.fetcher,
    );
    expect(reopened.messages[0]).toMatchObject({
      text: "I would like a bridge.",
      historical: true,
    });
    reopened.dispose();
    h.history.seek(0);
    const earlier = new ConversationSession(
      h.sim,
      h.temporal,
      2,
      () => {},
      h.fetcher,
    );
    expect(earlier.messages).toHaveLength(0);
    earlier.dispose();
  });
  it("does not send empty or overlong messages or duplicate a pending request", async () => {
    let resolve!: (v: Response) => void;
    const h = setup(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await h.session.send(" ");
    await h.session.send("x".repeat(501));
    expect(h.requests).toHaveLength(0);
    const pending = h.session.send("Hello");
    await h.session.send("Second");
    expect(h.requests).toHaveLength(1);
    resolve(json(answer(h.requests[0])));
    await pending;
    h.session.dispose();
  });
  it("closing mid-reply aborts it and records only the completed earlier exchange", async () => {
    let resolve!: (v: Response) => void;
    let calls = 0;
    const h = setup(async (r) =>
      ++calls === 1
        ? json(answer(r))
        : new Promise((done) => {
            resolve = done;
          }),
    );
    await h.session.send("First question");
    const late = h.session.send("Cancelled question");
    h.session.dispose();
    resolve(json(answer(h.requests[1])));
    await late;
    advance(h.sim, h.history);
    expect(h.sim.camp.conversations[2]).toHaveLength(1);
    expect(h.sim.camp.conversations[2][0].player).toBe("First question");
  });
  it("drops replies from a restored timeline even when a transport ignores abort", async () => {
    let resolve!: (v: Response) => void;
    const h = setup(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const p = h.session.send("An abandoned future question");
    h.history.seek(0);
    resolve(json(answer(h.requests[0])));
    await p;
    h.session.dispose();
    advance(h.sim, h.history);
    expect(h.sim.camp.conversations[2]).toBeUndefined();
  });
  it("falls back visibly when authentication fails without pretending the local reply is generated", async () => {
    const h = setup(async (r) => json(answer(r, "local")));
    await h.session.send("Hello");
    expect(h.session.notice).toContain("OpenAI rejected");
    expect(h.session.messages[1].source).toBe("local");
    h.session.dispose();
  });
  it("rejects wrong-actor replies and uses a bounded local answer", async () => {
    const h = setup(async (r) =>
      json({ ...answer(r), npcId: 3, reply: "wrong person" }),
    );
    await h.session.send("What is your work?");
    expect(h.session.messages[1].text).not.toBe("wrong person");
    expect(h.session.messages[1].source).toBe("local");
    h.session.dispose();
  });
  it("times out without freezing the panel and supplies a clearly local reply", async () => {
    vi.useFakeTimers();
    const h = setup(() => new Promise(() => {}));
    const p = h.session.send("What is your work?");
    await vi.advanceTimersByTimeAsync(9001);
    await p;
    expect(h.session.pending).toBe(false);
    expect(h.session.messages[1].source).toBe("local");
    expect(h.session.notice).toContain("unavailable");
    h.session.dispose();
  });
  it("does not contact providers when NPC AI is switched off", async () => {
    const h = setup(undefined, () => false);
    await h.session.send("Can you follow me?");
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.session.messages[1].text).toContain("work buttons");
    h.session.dispose();
  });
  it("never sends to invalid or unreachable NPCs or from temporal mode", async () => {
    for (const change of ["far", "temporal", "enemy"]) {
      const { sim, temporal } = scene();
      if (change === "far") sim.player.x = 60;
      if (change === "temporal") temporal.enter();
      const fetcher = vi.fn();
      const session = new ConversationSession(
        sim,
        temporal,
        change === "enemy" ? 10 : 2,
        () => {},
        fetcher,
      );
      await session.send("Hello");
      expect(session.disabled).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      session.dispose();
    }
  });
  it("keeps at most six exchanges in provider context and caps a paused session", async () => {
    const h = setup();
    for (let i = 0; i < 14; i++) await h.session.send(`Question ${i}`);
    expect(h.requests).toHaveLength(12);
    expect(h.requests[11].history).toHaveLength(6);
    expect(h.session.disabled).toBe(true);
    h.session.dispose();
  });
  it("invokes browser-native transport without the session as its receiver", async () => {
    const { sim, temporal } = scene();
    let receiver: unknown = "unset";
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(json(availability()));
    } as typeof fetch;
    const session = new ConversationSession(
      sim,
      temporal,
      2,
      () => {},
      fetcher,
    );
    await flush();
    expect(receiver).toBeUndefined();
    session.dispose();
  });
});
