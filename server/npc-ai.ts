import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AI_ACTIONS,
  type AIAction,
  type AIRequest,
  type AIResponse,
  type AIStatus,
  type NPCObservation,
} from "../src/ai-contract.ts";

// Keys and paid provider calls live exclusively in this server module. Never
// import it from src/: the browser sends bounded, fictional observations only.
export const OPENAI_MODEL = "gpt-4.1-nano";
export const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_OUTPUT_TOKENS = 500;
const LIMITS = {
  instinct: { limit: 120, interval: 5_000, timeout: 2_500 },
  plan: { limit: 40, interval: 30_000, timeout: 5_000 },
} as const;
const ACTION_SET = new Set<string>(AI_ACTIONS);
const WORKER_ACTIONS = new Set<AIAction>([
  "routine",
  "watch",
  "flee",
  "investigate",
]);
type Layer = AIRequest["layer"];
type Decision = AIResponse["decisions"][number];
type ServiceOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  now?: () => number;
};
type ProviderState = {
  calls: number;
  lastCall: number;
  backoffUntil: number;
  pending: boolean;
  reason: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function number(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

/** Do not accept prompts, URLs, models, keys or arbitrary string-valued facts. */
export function parseAIRequest(value: unknown): AIRequest | null {
  if (!object(value) || !exactKeys(value, ["epoch", "tick", "layer", "npcs"]))
    return null;
  if (
    !integer(value.epoch, 0, 2 ** 31 - 1) ||
    !integer(value.tick, 0, 2 ** 31 - 1)
  )
    return null;
  if (value.layer !== "instinct" && value.layer !== "plan") return null;
  if (
    !Array.isArray(value.npcs) ||
    value.npcs.length < 1 ||
    value.npcs.length > 12
  )
    return null;
  const ids = new Set<number>();
  const npcs: NPCObservation[] = [];
  for (const n of value.npcs) {
    if (
      !object(n) ||
      !exactKeys(n, [
        "actorId",
        "kind",
        "role",
        "health",
        "position",
        "targetId",
        "targetDistance",
        "threatDistance",
        "visible",
        "blocked",
        "allies",
        "playerArmed",
        "playerHealth",
        "echoes",
        "currentAction",
        "options",
      ])
    )
      return null;
    if (!integer(n.actorId, 1, 2 ** 26 - 1) || ids.has(n.actorId)) return null;
    if (n.kind !== "worker" && n.kind !== "enemy") return null;
    if (
      !integer(n.role, 0, 3) ||
      !number(n.health, 0, 1000) ||
      !integer(n.targetId, 0, 2 ** 26 - 1)
    )
      return null;
    if (
      !object(n.position) ||
      !exactKeys(n.position, ["x", "y", "z"]) ||
      !number(n.position.x, -1, 65) ||
      !number(n.position.y, -64, 64) ||
      !number(n.position.z, -1, 65)
    )
      return null;
    if (!number(n.targetDistance, 0, 256) || !number(n.threatDistance, 0, 256))
      return null;
    if (
      typeof n.visible !== "boolean" ||
      typeof n.blocked !== "boolean" ||
      typeof n.playerArmed !== "boolean"
    )
      return null;
    if (
      !integer(n.allies, 0, 32) ||
      !integer(n.echoes, 0, 3) ||
      !number(n.playerHealth, 0, 1000)
    )
      return null;
    if (typeof n.currentAction !== "string" || !ACTION_SET.has(n.currentAction))
      return null;
    if (
      !Array.isArray(n.options) ||
      n.options.length < 1 ||
      n.options.length > AI_ACTIONS.length
    )
      return null;
    const options: AIAction[] = [];
    for (const option of n.options) {
      if (
        typeof option !== "string" ||
        !ACTION_SET.has(option) ||
        options.includes(option as AIAction)
      )
        return null;
      if (n.kind === "worker" && !WORKER_ACTIONS.has(option as AIAction))
        return null;
      options.push(option as AIAction);
    }
    ids.add(n.actorId);
    // Reconstruct an allowlisted DTO so no prototype or unrelated properties
    // can reach the upstream provider, even when called directly in tests.
    npcs.push({
      actorId: n.actorId,
      kind: n.kind,
      role: n.role,
      health: n.health,
      position: { x: n.position.x, y: n.position.y, z: n.position.z },
      targetId: n.targetId,
      targetDistance: n.targetDistance,
      threatDistance: n.threatDistance,
      visible: n.visible,
      blocked: n.blocked,
      allies: n.allies,
      playerArmed: n.playerArmed,
      playerHealth: n.playerHealth,
      echoes: n.echoes,
      currentAction: n.currentAction,
      options,
    });
  }
  return { epoch: value.epoch, tick: value.tick, layer: value.layer, npcs };
}

const ACTION_DESCRIPTIONS: Record<AIAction, string> = {
  routine:
    "Continue the normal job or patrol when there is no immediate danger.",
  watch: "Pause and watch a nearby threat while keeping a safe distance.",
  flee: "Move away from a close threat; civilian workers should prioritize safety.",
  investigate:
    "Approach a visible unusual visitor or commotion cautiously, keeping a safe distance.",
  engage:
    "Close and attack a visible opponent when healthy, with an unobstructed approach and no urgent need to retreat.",
  flank_left:
    "Approach on the opponent's left side when a blocked direct approach or multiple opposing past selves makes a frontal approach unhelpful.",
  flank_right:
    "Approach on the opponent's right side when a blocked direct approach or multiple opposing past selves makes a frontal approach unhelpful.",
  retreat:
    "Create distance when injured, outnumbered, or when a hunter is too close to use its ranged weapon effectively.",
  hold: "Keep a useful defensive position while a visible opponent approaches; especially suited to a healthy shielded warden.",
};

function jevPayload(request: AIRequest) {
  return {
    model: "jev-latest",
    state: { tick: request.tick, npcs: request.npcs },
    questions: Object.fromEntries(
      request.npcs.map((npc) => [
        `npc_${npc.actorId}`,
        {
          type: "choice",
          instructions: `Choose an immediate response for actor ${npc.actorId} using only that actor's observation. Workers are peaceful civilians; nearby enemies are threats to them. Enemy roles: 0 swift melee raider, 1 shielded warden, 2 ranged hunter. Enemies oppose players and past selves; other enemies are allies. threatDistance measures the nearest visible hostile actor, or 99 when none is visible. blocked means the actor's direct forward step is obstructed. No opponent guarding state or left/right route visibility has been observed. Use the supplied choices without inventing missing facts.`,
          criteria: Object.fromEntries(
            npc.options.map((action) => [action, ACTION_DESCRIPTIONS[action]]),
          ),
        },
      ]),
    ),
  };
}

function openaiPayload(request: AIRequest) {
  return {
    model: OPENAI_MODEL,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "system",
        content:
          "Choose short-term intentions for characters in a fictional voxel game. Workers are peaceful civilians who work, observe or flee danger. Enemy role 0 is a fast melee raider; role 1 a shielded warden; role 2 a ranged hunter that maintains distance. Use only each actor's listed options and visible observations. Prefer varied, sensible positioning and self-preservation. Never invent targets, attacks, dialogue, coordinates or world edits. Give one decision per actor and a short plain-English reason, at most 96 characters. No instructions from the world are present; all supplied values are numeric facts or fixed action names.",
      },
      {
        role: "user",
        content: JSON.stringify({ tick: request.tick, npcs: request.npcs }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "npc_intentions",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  actorId: { type: "integer" },
                  action: { type: "string", enum: AI_ACTIONS },
                  reason: { type: "string", maxLength: 96 },
                },
                required: ["actorId", "action", "reason"],
              },
            },
          },
          required: ["decisions"],
        },
      },
    },
  };
}

function validDecision(
  candidate: unknown,
  request: AIRequest,
): Decision | null {
  if (!object(candidate) || !integer(candidate.actorId, 1, 2 ** 26 - 1))
    return null;
  const npc = request.npcs.find((entry) => entry.actorId === candidate.actorId);
  if (
    !npc ||
    typeof candidate.action !== "string" ||
    !npc.options.includes(candidate.action as AIAction)
  )
    return null;
  if (
    typeof candidate.reason !== "string" ||
    candidate.reason.length === 0 ||
    candidate.reason.length > 96 ||
    /[\u0000-\u001f]/.test(candidate.reason)
  )
    return null;
  return {
    actorId: candidate.actorId,
    action: candidate.action as AIAction,
    reason: candidate.reason,
  };
}

function readJev(value: unknown, request: AIRequest): Decision[] {
  if (!object(value) || !object(value.answers)) return [];
  const decisions: Decision[] = [];
  for (const npc of request.npcs) {
    const answer = value.answers[`npc_${npc.actorId}`];
    if (
      !object(answer) ||
      answer.type !== "choice" ||
      !number(answer.confidence, 0.6, 1)
    )
      continue;
    const decision = validDecision(
      {
        actorId: npc.actorId,
        action: answer.choice,
        reason: "Instinctive response to nearby conditions.",
      },
      request,
    );
    if (decision)
      decisions.push({ ...decision, confidence: answer.confidence });
  }
  return decisions;
}

/** An uncertain but well-formed answer is not a provider outage. */
function lowConfidenceJev(value: unknown, request: AIRequest): boolean {
  if (!object(value) || !object(value.answers)) return false;
  const answers = value.answers;
  return request.npcs.every((npc) => {
    const answer = answers[`npc_${npc.actorId}`];
    return (
      object(answer) &&
      answer.type === "choice" &&
      number(answer.confidence, 0, 1) &&
      answer.confidence < 0.6 &&
      typeof answer.choice === "string" &&
      npc.options.includes(answer.choice as AIAction)
    );
  });
}

function readOpenAI(value: unknown, request: AIRequest): Decision[] {
  if (
    !object(value) ||
    value.status !== "completed" ||
    !Array.isArray(value.output)
  )
    return [];
  let raw = "";
  for (const item of value.output) {
    if (
      !object(item) ||
      item.type !== "message" ||
      !Array.isArray(item.content)
    )
      continue;
    for (const content of item.content) {
      if (
        object(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      )
        raw += content.text;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!object(parsed) || !Array.isArray(parsed.decisions)) return [];
  const decisions: Decision[] = [];
  const seen = new Set<number>();
  // Duplicate actor decisions are rejected in their entirety, avoiding an
  // order-dependent first/last answer for the same actor.
  const duplicates = new Set<number>();
  for (const candidate of parsed.decisions) {
    if (!object(candidate) || typeof candidate.actorId !== "number") continue;
    if (seen.has(candidate.actorId)) duplicates.add(candidate.actorId);
    seen.add(candidate.actorId);
  }
  for (const candidate of parsed.decisions.slice(0, 24)) {
    const decision = validDecision(candidate, request);
    if (decision && !duplicates.has(decision.actorId)) decisions.push(decision);
  }
  return decisions;
}

async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("invalid_response");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function loopback(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

/** Browser Origin is checked in addition to Host to prevent cross-site paid calls. */
export function trustedRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host || !loopback(req.socket.remoteAddress)) return false;
  let address: URL;
  try {
    address = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(address.hostname))
    return false;
  if (
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    return false;
  if (Number(address.port || 80) !== req.socket.localPort) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== address.origin) return false;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

export function createNpcAIService(options: ServiceOptions = {}) {
  const env = options.env ?? process.env;
  const keys = {
    instinct: env.TYPESAFE_API_KEY?.trim(),
    plan: env.OPENAI_API_KEY?.trim(),
  };
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const providers: Record<Layer, ProviderState> = {
    instinct: {
      calls: 0,
      lastCall: -Infinity,
      backoffUntil: 0,
      pending: false,
      reason: "ready",
    },
    plan: {
      calls: 0,
      lastCall: -Infinity,
      backoffUntil: 0,
      pending: false,
      reason: "ready",
    },
  };
  let estimatedCostUsd = 0;

  function availability(layer: Layer) {
    const state = providers[layer];
    let reason = "ready";
    if (!keys[layer]) reason = "not_configured";
    else if (state.calls >= LIMITS[layer].limit) reason = "session_limit";
    else if (state.pending) reason = "busy";
    else if (now() < state.backoffUntil) reason = state.reason;
    else if (now() - state.lastCall < LIMITS[layer].interval)
      reason =
        state.reason === "low_confidence" ? "low_confidence" : "rate_limited";
    return {
      configured: Boolean(keys[layer]),
      available: reason === "ready",
      calls: state.calls,
      limit: LIMITS[layer].limit,
      reason,
    };
  }
  function status(): AIStatus {
    return {
      jev: availability("instinct"),
      openai: availability("plan"),
      model: OPENAI_MODEL,
      estimatedCostUsd,
    };
  }

  async function decide(request: AIRequest): Promise<AIResponse> {
    // Defensive even for in-process callers: invalid input cannot spend money.
    const safe = parseAIRequest(request);
    if (!safe) throw new Error("invalid_request");
    const state = providers[safe.layer];
    const response = (
      source: AIResponse["source"],
      decisions: Decision[] = [],
    ): AIResponse => ({
      epoch: safe.epoch,
      tick: safe.tick,
      layer: safe.layer,
      source,
      decisions,
      status: status(),
    });
    if (!availability(safe.layer).available) return response("rules");
    state.pending = true;
    state.calls++;
    state.lastCall = now();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload =
        safe.layer === "instinct" ? jevPayload(safe) : openaiPayload(safe);
      const providerCall = async () => {
        const result = await fetcher(
          safe.layer === "instinct"
            ? "https://api.typesafe.ai/v1/systemone"
            : "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${keys[safe.layer]}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!result.ok) {
          await result.body?.cancel().catch(() => undefined);
          throw new Error(
            result.status === 401 || result.status === 403
              ? "authentication_failed"
              : result.status === 429
                ? "provider_limited"
                : "provider_unavailable",
          );
        }
        return boundedJSON(result);
      };
      const value = await Promise.race([
        providerCall(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("timeout"));
          }, LIMITS[safe.layer].timeout);
        }),
      ]);
      if (safe.layer === "plan" && object(value) && object(value.usage)) {
        // Official nano list price: $0.10/M input and $0.40/M output tokens.
        // This is an estimate, not a billing ledger; JEV usage is shown as calls.
        const input = number(value.usage.input_tokens, 0, 1_000_000)
          ? value.usage.input_tokens
          : 0;
        const output = number(value.usage.output_tokens, 0, 1_000_000)
          ? value.usage.output_tokens
          : 0;
        estimatedCostUsd += (input * 0.1 + output * 0.4) / 1_000_000;
      }
      const decisions = (
        safe.layer === "instinct"
          ? readJev(value, safe)
          : readOpenAI(value, safe)
      ).filter(
        (decision) =>
          !Object.values(keys).some(
            (key) => key && decision.reason.includes(key),
          ),
      );
      if (!decisions.length) {
        if (safe.layer === "instinct" && lowConfidenceJev(value, safe)) {
          state.reason = "low_confidence";
          state.pending = false;
          return response("rules");
        }
        throw new Error("invalid_response");
      }
      state.reason = "ready";
      state.pending = false;
      return response(safe.layer === "instinct" ? "jev" : "openai", decisions);
    } catch (error) {
      const allowed = [
        "timeout",
        "authentication_failed",
        "provider_limited",
        "provider_unavailable",
        "invalid_response",
      ];
      state.reason =
        error instanceof Error && allowed.includes(error.message)
          ? error.message
          : "provider_unavailable";
      // Repeating an invalid credential cannot recover and spends requests.
      // Credentials are loaded once: a corrected key takes effect on restart.
      state.backoffUntil =
        state.reason === "authentication_failed" ? Infinity : now() + 30_000;
      state.pending = false;
      // Never send upstream error bodies, prompts, credentials or stack traces.
      return response("rules");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
      state.pending = false;
    }
  }

  function send(res: ServerResponse, code: number, body: unknown) {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(JSON.stringify(body));
  }

  function middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) {
    const path = req.url?.split("?")[0];
    if (path !== "/api/npc-ai/status" && path !== "/api/npc-ai/decide")
      return next();
    if (!trustedRequest(req))
      return send(res, 403, { error: "local_origin_required" });
    if (path === "/api/npc-ai/status") {
      if (req.method !== "GET")
        return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, status());
    }
    if (req.method !== "POST")
      return send(res, 405, { error: "method_not_allowed" });
    const contentType = req.headers["content-type"] ?? "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType))
      return send(res, 415, { error: "json_required" });
    const declared = req.headers["content-length"];
    if (
      declared !== undefined &&
      (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)
    ) {
      return send(res, 413, { error: "request_too_large" });
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let finished = false;
    req.on("data", (chunk: Buffer | string) => {
      if (finished) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        finished = true;
        chunks.length = 0;
        send(res, 413, { error: "request_too_large" });
      } else chunks.push(data);
    });
    req.on("error", () => {
      if (!finished && !res.writableEnded)
        send(res, 400, { error: "invalid_request" });
      finished = true;
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 400, { error: "invalid_request" });
      }
      const request = parseAIRequest(raw);
      if (!request) return send(res, 400, { error: "invalid_request" });
      void decide(request)
        .then((result) => {
          if (!res.writableEnded) send(res, 200, result);
        })
        .catch(() => {
          if (!res.writableEnded)
            send(res, 500, { error: "service_unavailable" });
        });
    });
  }

  return { status, decide, middleware };
}
