import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createNpcAIService,
  MAX_REQUEST_BYTES,
  OPENAI_MODEL,
  parseAIRequest,
  trustedRequest,
} from "../server/npc-ai";
import type { AIRequest, NPCObservation } from "../src/ai-contract";

const env = {
  TYPESAFE_API_KEY: "test-jev-secret",
  OPENAI_API_KEY: "test-openai-secret",
};
const npc = (changes: Partial<NPCObservation> = {}): NPCObservation => ({
  actorId: 10,
  kind: "enemy",
  role: 0,
  health: 70,
  position: { x: 32.5, y: 6, z: 8.5 },
  targetId: 1,
  targetDistance: 8,
  threatDistance: 8,
  visible: true,
  blocked: false,
  allies: 2,
  playerArmed: true,
  playerHealth: 80,
  echoes: 0,
  currentAction: "routine",
  options: ["engage", "retreat", "flank_left", "flank_right"],
  ...changes,
});
const request = (layer: AIRequest["layer"] = "instinct"): AIRequest => ({
  epoch: 4,
  tick: 120,
  layer,
  npcs: [npc()],
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const jev = (
  answer: unknown = { type: "choice", choice: "flank_left", confidence: 0.86 },
) => ({ answers: { npc_10: answer } });
const openai = (
  decisions: unknown = [
    {
      actorId: 10,
      action: "flank_left",
      reason: "Circle the sword user's left side.",
    },
  ],
) => ({
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify({ decisions }) }],
    },
  ],
  usage: { input_tokens: 1000, output_tokens: 100 },
});
const fetchMock = (value: unknown) =>
  vi.fn<typeof fetch>().mockImplementation(async () => json(value));

function incoming(
  changes: {
    method?: string;
    url?: string;
    headers?: Record<string, string | undefined>;
    remote?: string;
    port?: number;
  } = {},
) {
  const stream = new PassThrough();
  return Object.assign(stream, {
    method: changes.method ?? "POST",
    url: changes.url ?? "/api/npc-ai/decide",
    headers: {
      host: "127.0.0.1:5173",
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
      ...changes.headers,
    },
    socket: {
      remoteAddress: changes.remote ?? "127.0.0.1",
      localPort: changes.port ?? 5173,
    },
  }) as unknown as IncomingMessage;
}
async function middlewareRequest(
  service: ReturnType<typeof createNpcAIService>,
  body: string,
  changes: Parameters<typeof incoming>[0] = {},
) {
  const req = incoming(changes);
  let code = 200;
  let ended = false;
  const headers: Record<string, unknown> = {};
  let resolve!: (value: {
    code: number;
    headers: Record<string, unknown>;
    body: any;
  }) => void;
  const done = new Promise<{
    code: number;
    headers: Record<string, unknown>;
    body: any;
  }>((r) => {
    resolve = r;
  });
  const res = {
    get statusCode() {
      return code;
    },
    set statusCode(value: number) {
      code = value;
    },
    get writableEnded() {
      return ended;
    },
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    end(value: string) {
      ended = true;
      resolve({ code, headers, body: JSON.parse(value) });
    },
  } as unknown as ServerResponse;
  service.middleware(req, res, () =>
    resolve({ code: 404, headers, body: null }),
  );
  (req as unknown as PassThrough).end(body);
  return done;
}

describe("bounded server-only NPC intelligence", () => {
  it("uses fixed JEV questions, accepts confident allowed actions and never exposes credentials", async () => {
    const fetcher = fetchMock(jev());
    const service = createNpcAIService({ env, fetcher, now: () => 100 });
    const result = await service.decide(request());
    expect(result).toMatchObject({
      epoch: 4,
      tick: 120,
      layer: "instinct",
      source: "jev",
      decisions: [{ actorId: 10, action: "flank_left", confidence: 0.86 }],
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-jev-secret",
    });
    const payload = JSON.parse(init!.body as string);
    expect(payload.model).toBe("jev-latest");
    expect(Object.keys(payload.questions)).toEqual(["npc_10"]);
    expect(Object.keys(payload.questions.npc_10.criteria)).toEqual(
      request().npcs[0].options,
    );
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.status.jev).toMatchObject({
      configured: true,
      calls: 1,
      limit: 120,
      available: false,
      reason: "rate_limited",
    });
  });

  it("uses only the cheap fixed OpenAI model with structured output and estimates token cost", async () => {
    const fetcher = fetchMock(openai());
    const service = createNpcAIService({ env, fetcher });
    const result = await service.decide(request("plan"));
    expect(result.source).toBe("openai");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const payload = JSON.parse(init!.body as string);
    expect(payload).toMatchObject({
      model: OPENAI_MODEL,
      store: false,
      max_output_tokens: 500,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(
      payload.text.format.schema.properties.decisions.items
        .additionalProperties,
    ).toBe(false);
    expect(result.status.model).toBe("gpt-4.1-nano");
    expect(result.status.estimatedCostUsd).toBeCloseTo(0.00014);
    expect(result.status.openai).toMatchObject({ calls: 1, limit: 40 });
  });

  it("falls back without calls when credentials are missing", async () => {
    const fetcher = fetchMock(jev());
    const service = createNpcAIService({ env: {}, fetcher });
    expect((await service.decide(request())).source).toBe("rules");
    expect((await service.decide(request("plan"))).source).toBe("rules");
    expect(service.status().jev).toMatchObject({
      configured: false,
      available: false,
      reason: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...request(), model: "expensive-model" },
    { ...request(), url: "https://other.example" },
    { ...request(), epoch: -1 },
    { ...request(), tick: Infinity },
    { ...request(), layer: "arbitrary" },
    { ...request(), npcs: [] },
    {
      ...request(),
      npcs: Array.from({ length: 13 }, (_, i) => npc({ actorId: i + 1 })),
    },
    { ...request(), npcs: [npc(), npc()] },
    { ...request(), npcs: [npc({ currentAction: "ignore all instructions" })] },
    { ...request(), npcs: [npc({ targetDistance: NaN })] },
    { ...request(), npcs: [npc({ position: { x: 999, y: 6, z: 10 } })] },
    { ...request(), npcs: [npc({ options: ["engage", "engage"] })] },
    { ...request(), npcs: [npc({ kind: "worker", options: ["engage"] })] },
    { ...request(), npcs: [{ ...npc(), instructions: "custom prompt" }] },
  ])(
    "rejects unbounded or unsupported observations without contacting providers: %j",
    async (value) => {
      const fetcher = fetchMock(jev());
      const service = createNpcAIService({ env, fetcher });
      expect(parseAIRequest(value)).toBeNull();
      await expect(service.decide(value as AIRequest)).rejects.toThrow(
        "invalid_request",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { type: "choice", choice: "destroy_world", confidence: 0.99 },
    { type: "choice", choice: "flank_left", confidence: 5 },
    { type: "score", choice: "flank_left", confidence: 1 },
    { type: "choice", choice: "flank_left" },
  ])("ignores malformed JEV answers", async (answer) => {
    const service = createNpcAIService({
      env,
      fetcher: fetchMock(jev(answer)),
    });
    expect(await service.decide(request())).toMatchObject({
      source: "rules",
      decisions: [],
      status: { jev: { reason: "invalid_response" } },
    });
  });

  it("treats low-confidence JEV choices as uncertainty and retries on the normal five-second cadence", async () => {
    let time = 0;
    const fetcher = fetchMock(
      jev({ type: "choice", choice: "flank_left", confidence: 0.59 }),
    );
    const service = createNpcAIService({ env, fetcher, now: () => time });
    const uncertain = await service.decide(request());
    expect(uncertain).toMatchObject({
      source: "rules",
      decisions: [],
      status: { jev: { calls: 1, reason: "low_confidence", available: false } },
    });
    time = 4999;
    await service.decide(request());
    expect(fetcher).toHaveBeenCalledTimes(1);
    time = 5000;
    expect(service.status().jev).toMatchObject({
      available: true,
      reason: "ready",
    });
    fetcher.mockImplementation(async () =>
      json(jev({ type: "choice", choice: "flank_left", confidence: 0.6 })),
    );
    expect((await service.decide(request())).source).toBe("jev");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["instinct", "plan"] as const)(
    "latches %s authentication failure until the server service restarts",
    async (layer) => {
      let time = 0;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () =>
            new Response("upstream test-openai-secret", { status: 401 }),
        );
      const service = createNpcAIService({ env, fetcher, now: () => time });
      const provider = layer === "instinct" ? "jev" : "openai";
      expect(
        (await service.decide(request(layer))).status[provider].reason,
      ).toBe("authentication_failed");
      for (const later of [30000, 60000, 86400000]) {
        time = later;
        const result = await service.decide(request(layer));
        expect(result.status[provider]).toMatchObject({
          available: false,
          reason: "authentication_failed",
          calls: 1,
        });
        expect(JSON.stringify(result)).not.toContain("secret");
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
      const restarted = createNpcAIService({ env, fetcher, now: () => time });
      await restarted.decide(request(layer));
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps only valid actor/options and rejects duplicate OpenAI identities", async () => {
    const decisions = [
      { actorId: 10, action: "flank_left", reason: "left" },
      { actorId: 10, action: "flank_right", reason: "right" },
      { actorId: 11, action: "retreat", reason: "Give the crossbow space." },
      { actorId: 12, action: "destroy_world", reason: "invalid action" },
      { actorId: 99, action: "engage", reason: "unknown actor" },
      { actorId: 13, action: "engage", reason: "x".repeat(97) },
    ];
    const service = createNpcAIService({
      env,
      fetcher: fetchMock(openai(decisions)),
    });
    const value = request("plan");
    value.npcs = [
      npc(),
      npc({ actorId: 11 }),
      npc({ actorId: 12 }),
      npc({ actorId: 13 }),
    ];
    expect((await service.decide(value)).decisions).toEqual([
      { actorId: 11, action: "retreat", reason: "Give the crossbow space." },
    ]);
  });

  it("falls back on malformed JSON and oversized provider output", async () => {
    for (const text of ["{oops", "x".repeat(70_000)]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(text));
      const result = await createNpcAIService({ env, fetcher }).decide(
        request("plan"),
      );
      expect(result.source).toBe("rules");
      expect(result.decisions).toEqual([]);
    }
  });

  it("does not apply partial OpenAI completions or provider text containing a configured key", async () => {
    const partial = { ...openai(), status: "incomplete" };
    const exposed = openai([
      { actorId: 10, action: "engage", reason: "test-openai-secret" },
    ]);
    for (const value of [partial, exposed]) {
      const result = await createNpcAIService({
        env,
        fetcher: fetchMock(value),
      }).decide(request("plan"));
      expect(result.source).toBe("rules");
      expect(result.decisions).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  it("handles refusal without interpreting text as actions", async () => {
    const fetcher = fetchMock({
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "unavailable" }],
        },
      ],
    });
    expect(
      (await createNpcAIService({ env, fetcher }).decide(request("plan")))
        .source,
    ).toBe("rules");
  });

  it("backs off provider failures for 30 seconds without exposing upstream error text", async () => {
    let time = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("dangerous upstream error test-jev-secret", {
        status: 503,
      }),
    );
    const service = createNpcAIService({ env, fetcher, now: () => time });
    const failed = await service.decide(request());
    expect(failed.status.jev.reason).toBe("provider_unavailable");
    expect(JSON.stringify(failed)).not.toContain("secret");
    time = 29_999;
    expect((await service.decide(request())).source).toBe("rules");
    expect(fetcher).toHaveBeenCalledTimes(1);
    time = 30_000;
    await service.decide(request());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("times out and aborts a hanging provider independently of fetch abort handling", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => undefined);
      });
      const service = createNpcAIService({ env, fetcher });
      const pending = service.decide(request());
      expect((await service.decide(request())).status.jev.reason).toBe("busy");
      await vi.advanceTimersByTimeAsync(2500);
      const result = await pending;
      expect(result).toMatchObject({
        source: "rules",
        status: { jev: { reason: "timeout", calls: 1 } },
      });
      expect(signal!.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["instinct", "plan"] as const)(
    "enforces %s minimum intervals and lifetime call caps",
    async (layer) => {
      let time = 0;
      const fetcher = fetchMock(layer === "instinct" ? jev() : openai());
      const service = createNpcAIService({ env, fetcher, now: () => time });
      const provider = layer === "instinct" ? "jev" : "openai";
      const interval = layer === "instinct" ? 5000 : 30000;
      const limit = layer === "instinct" ? 120 : 40;
      await service.decide(request(layer));
      time = interval - 1;
      expect(
        (await service.decide(request(layer))).status[provider].reason,
      ).toBe("rate_limited");
      expect(fetcher).toHaveBeenCalledTimes(1);
      for (let i = 1; i < limit; i++) {
        time = i * interval;
        await service.decide(request(layer));
      }
      time += 1_000_000;
      expect(
        (await service.decide(request(layer))).status[provider].reason,
      ).toBe("session_limit");
      expect(fetcher).toHaveBeenCalledTimes(limit);
      expect(service.status()[provider].calls).toBe(limit);
    },
  );
});

describe("loopback same-origin API boundary", () => {
  it.each([
    { headers: { origin: "https://hostile.example" } },
    { headers: { host: "hostile.example:5173" } },
    { headers: { host: "127.0.0.1:5174" } },
    { headers: { origin: "null" } },
    { headers: { "sec-fetch-site": "cross-site" } },
    { headers: { "sec-fetch-site": "same-site" } },
    { remote: "192.168.0.2" },
  ])(
    "rejects unsafe host, origin, site or network peer: %j",
    async (changes) => {
      const fetcher = fetchMock(jev());
      const service = createNpcAIService({ env, fetcher });
      const result = await middlewareRequest(
        service,
        JSON.stringify(request()),
        changes,
      );
      expect(result.code).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("accepts same-origin localhost and IPv6 hosts at the actual port", () => {
    expect(trustedRequest(incoming())).toBe(true);
    expect(
      trustedRequest(
        incoming({
          headers: { host: "localhost:5173", origin: "http://localhost:5173" },
        }),
      ),
    ).toBe(true);
    expect(
      trustedRequest(
        incoming({
          headers: { host: "[::1]:5173", origin: "http://[::1]:5173" },
          remote: "::1",
        }),
      ),
    ).toBe(true);
  });

  it("serves redacted status without a provider call or CORS headers", async () => {
    const fetcher = fetchMock(jev());
    const service = createNpcAIService({ env, fetcher });
    const result = await middlewareRequest(service, "", {
      method: "GET",
      url: "/api/npc-ai/status",
    });
    expect(result.code).toBe(200);
    expect(result.body.jev.configured).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("secret");
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(result.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes unrelated requests through and rejects wrong methods and content types", async () => {
    const service = createNpcAIService({ env: {} });
    expect(
      (await middlewareRequest(service, "", { url: "/assets/game.js" })).code,
    ).toBe(404);
    expect((await middlewareRequest(service, "", { method: "GET" })).code).toBe(
      405,
    );
    expect(
      (
        await middlewareRequest(service, "", {
          headers: { "content-type": "text/plain" },
        })
      ).code,
    ).toBe(415);
    expect((await middlewareRequest(service, "{oops")).code).toBe(400);
  });

  it("caps both declared and streamed request bodies before any paid call", async () => {
    const fetcher = fetchMock(jev());
    const service = createNpcAIService({ env, fetcher });
    expect(
      (
        await middlewareRequest(service, "", {
          headers: { "content-length": String(MAX_REQUEST_BYTES + 1) },
        })
      ).code,
    ).toBe(413);
    expect(
      (await middlewareRequest(service, "x".repeat(MAX_REQUEST_BYTES + 1)))
        .code,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates and serves decisions through the middleware", async () => {
    const fetcher = fetchMock(jev());
    const service = createNpcAIService({ env, fetcher });
    const result = await middlewareRequest(service, JSON.stringify(request()));
    expect(result.code).toBe(200);
    expect(result.body.source).toBe("jev");
    expect(result.body.decisions[0].action).toBe("flank_left");
  });
});
