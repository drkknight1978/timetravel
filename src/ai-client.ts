import type { Simulation } from "./simulation";
import type { Temporal } from "./temporal";
import type {
  AILayer,
  AIRequest,
  AIResponse,
  AIStatus,
  ProviderStatus,
} from "./ai-contract";
import { observeNPCs } from "./intelligence";

const CADENCE = {
  instinct: { milliseconds: 5_000, ticks: 300, timeout: 3_500 },
  plan: { milliseconds: 30_000, ticks: 1_800, timeout: 6_000 },
} as const;
const RETRY_MS = 30_000;
const MAX_REPLY_AGE = 300;
type Pending = { controller: AbortController; generation: number };
const normalCadence = (p: ProviderStatus) =>
  p.reason === "rate_limited" || p.reason === "low_confidence";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function provider(value: unknown): ProviderStatus | undefined {
  if (
    !object(value) ||
    typeof value.configured !== "boolean" ||
    typeof value.available !== "boolean" ||
    !Number.isSafeInteger(value.calls) ||
    (value.calls as number) < 0 ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 0 ||
    typeof value.reason !== "string" ||
    value.reason.length > 256
  )
    return;
  return {
    configured: value.configured,
    available: value.available,
    calls: value.calls as number,
    limit: value.limit as number,
    reason: value.reason.replace(/[\u0000-\u001f\u007f]/g, " "),
  };
}

function readStatus(value: unknown): AIStatus | undefined {
  if (!object(value)) return;
  const jev = provider(value.jev);
  const openai = provider(value.openai);
  if (
    !jev ||
    !openai ||
    typeof value.model !== "string" ||
    value.model.length > 80 ||
    typeof value.estimatedCostUsd !== "number" ||
    !Number.isFinite(value.estimatedCostUsd) ||
    value.estimatedCostUsd < 0
  )
    return;
  return {
    jev,
    openai,
    model: value.model,
    estimatedCostUsd: value.estimatedCostUsd,
  };
}

function readResponse(
  value: unknown,
  request: AIRequest,
): AIResponse | undefined {
  if (
    !object(value) ||
    value.epoch !== request.epoch ||
    value.tick !== request.tick ||
    value.layer !== request.layer ||
    (value.source !== "rules" &&
      value.source !== (request.layer === "instinct" ? "jev" : "openai")) ||
    !Array.isArray(value.decisions) ||
    value.decisions.length > request.npcs.length
  )
    return;
  const status = readStatus(value.status);
  if (!status || (value.source === "rules" && value.decisions.length)) return;
  const decisions: AIResponse["decisions"] = [];
  const seen = new Set<number>();
  for (const item of value.decisions) {
    if (!object(item)) return;
    const npc = request.npcs.find((n) => n.actorId === item.actorId);
    if (
      !npc ||
      seen.has(npc.actorId) ||
      !npc.options.some((action) => action === item.action) ||
      typeof item.reason !== "string" ||
      item.reason.length > 96 ||
      (item.confidence !== undefined &&
        (typeof item.confidence !== "number" ||
          !Number.isFinite(item.confidence) ||
          item.confidence < 0 ||
          item.confidence > 1)) ||
      (value.source === "jev" &&
        (typeof item.confidence !== "number" || item.confidence < 0.6))
    )
      return;
    seen.add(npc.actorId);
    decisions.push({
      actorId: npc.actorId,
      action: item.action as AIResponse["decisions"][number]["action"],
      reason: item.reason.replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
      ...(item.confidence === undefined
        ? {}
        : { confidence: item.confidence as number }),
    });
  }
  return {
    epoch: request.epoch,
    tick: request.tick,
    layer: request.layer,
    source: value.source as AIResponse["source"],
    decisions,
    status,
  };
}

/** Network answers only queue choices for a future simulation tick. They never step the world. */
export class IntelligenceClient {
  enabled = true;
  status: AIStatus | undefined;
  lastMessage = "Rules active · checking local AI";
  private active = false;
  private generation = 0;
  private seenEpoch: number;
  private statusAt = -Infinity;
  private statusRetryAt = -Infinity;
  private statusPending: Pending | undefined;
  private decisionPending: Pending | undefined;
  private lastAt: Record<AILayer, number> = {
    instinct: -Infinity,
    plan: -Infinity,
  };
  private lastTick: Record<AILayer, number> = {
    instinct: -Infinity,
    plan: -Infinity,
  };
  private retryAt: Record<AILayer, number> = {
    instinct: -Infinity,
    plan: -Infinity,
  };

  constructor(
    private readonly sim: Simulation,
    private readonly temporal: Temporal,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.seenEpoch = sim.epoch;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.invalidate();
    this.refreshMessage();
  }

  /** Call synchronously before a pause, temporal transition, or other interruption. */
  invalidate(): void {
    this.generation++;
    this.statusPending?.controller.abort();
    this.decisionPending?.controller.abort();
    this.statusPending = undefined;
    this.decisionPending = undefined;
    this.sim.clearQueuedAI();
  }

  update(active: boolean): void {
    const shouldRun = active && this.enabled && this.temporal.mode === "live";
    if (!shouldRun) {
      if (this.active) this.invalidate();
      this.active = false;
      return;
    }
    this.active = true;
    if (this.seenEpoch !== this.sim.epoch) {
      this.invalidate();
      this.seenEpoch = this.sim.epoch;
      // A restored timeline has its own simulation clock; real-time limits remain in force.
      this.lastTick = { instinct: -Infinity, plan: -Infinity };
    }
    const now = this.now();
    if (this.statusPending || this.decisionPending) return;
    if (
      now >= this.statusRetryAt &&
      (!this.status || now - this.statusAt >= RETRY_MS)
    ) {
      this.fetchStatus();
      return;
    }
    if (!this.status) return;
    for (const layer of ["instinct", "plan"] as const) {
      const source = layer === "instinct" ? "jev" : "openai";
      const providerStatus = this.status[source];
      const cadence = CADENCE[layer];
      if (
        !providerStatus.configured ||
        (!providerStatus.available && !normalCadence(providerStatus)) ||
        (normalCadence(providerStatus) &&
          !Number.isFinite(this.lastAt[layer]) &&
          now - this.statusAt < cadence.milliseconds) ||
        providerStatus.calls >= providerStatus.limit ||
        now < this.retryAt[layer] ||
        now - this.lastAt[layer] < cadence.milliseconds ||
        this.sim.tick - this.lastTick[layer] < cadence.ticks
      )
        continue;
      const npcs = observeNPCs(this.sim)
        .filter((npc) => npc.options.length > 1)
        .slice(0, 7);
      if (!npcs.length) return;
      const request: AIRequest = {
        epoch: this.sim.epoch,
        tick: this.sim.tick,
        layer,
        npcs,
      };
      this.lastAt[layer] = now;
      this.lastTick[layer] = this.sim.tick;
      this.fetchDecision(request);
      return;
    }
  }

  private current(pending: Pending, epoch: number): boolean {
    return (
      this.active &&
      this.enabled &&
      this.temporal.mode === "live" &&
      pending.generation === this.generation &&
      !pending.controller.signal.aborted &&
      this.sim.epoch === epoch
    );
  }

  private async json(
    url: string,
    pending: Pending,
    timeout: number,
    body?: AIRequest,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        pending.controller.abort();
        reject(new Error("Local AI timeout"));
      }, timeout);
    });
    try {
      return await Promise.race([
        (async () => {
          // Native browser fetch must not receive this client as its receiver.
          const fetcher = this.fetcher;
          const response = await fetcher(url, {
            method: body ? "POST" : "GET",
            signal: pending.controller.signal,
            credentials: "same-origin",
            cache: "no-store",
            ...(body
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              : {}),
          });
          if (!response.ok) throw new Error("Local AI unavailable");
          return response.json() as Promise<unknown>;
        })(),
        expired,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private fetchStatus(): void {
    const pending: Pending = {
      controller: new AbortController(),
      generation: this.generation,
    };
    const epoch = this.sim.epoch;
    this.statusPending = pending;
    this.statusAt = this.now();
    void this.json("/api/npc-ai/status", pending, 3_500)
      .then((data) => {
        if (!this.current(pending, epoch)) return;
        const status = readStatus(data);
        if (!status) throw new Error("Invalid local AI status");
        this.status = status;
        this.statusAt = this.now();
        this.refreshMessage();
      })
      .catch(() => {
        if (pending.generation !== this.generation || this.sim.epoch !== epoch)
          return;
        this.statusRetryAt = this.now() + RETRY_MS;
        this.lastMessage = "Rules only · local AI service unavailable";
      })
      .finally(() => {
        if (this.statusPending === pending) this.statusPending = undefined;
      });
  }

  private fetchDecision(request: AIRequest): void {
    const pending: Pending = {
      controller: new AbortController(),
      generation: this.generation,
    };
    this.decisionPending = pending;
    void this.json(
      "/api/npc-ai/decide",
      pending,
      CADENCE[request.layer].timeout,
      request,
    )
      .then((data) => {
        if (
          !this.current(pending, request.epoch) ||
          this.sim.tick < request.tick ||
          this.sim.tick - request.tick > MAX_REPLY_AGE
        )
          return;
        const response = readResponse(data, request);
        if (!response) throw new Error("Invalid local AI response");
        this.status = response.status;
        this.statusAt = this.now();
        this.refreshMessage();
        if (response.source !== "rules" && response.decisions.length)
          this.sim.queueAI(response);
      })
      .catch(() => {
        if (
          pending.generation !== this.generation ||
          this.sim.epoch !== request.epoch
        )
          return;
        this.retryAt[request.layer] = this.now() + RETRY_MS;
        if (this.status) {
          const source = request.layer === "instinct" ? "jev" : "openai";
          this.status = {
            ...this.status,
            [source]: {
              ...this.status[source],
              available: false,
              reason: "Temporarily unavailable",
            },
          };
        }
        this.statusAt = this.now();
        this.refreshMessage();
      })
      .finally(() => {
        if (this.decisionPending === pending) this.decisionPending = undefined;
      });
  }

  private refreshMessage(): void {
    if (!this.enabled) {
      this.lastMessage = "AI updates off · current intentions finish naturally";
      return;
    }
    if (!this.status) {
      this.lastMessage = "Rules active · checking local AI";
      return;
    }
    const usable = (p: ProviderStatus) =>
      p.configured && (p.available || normalCadence(p)) && p.calls < p.limit;
    const jev = usable(this.status.jev);
    const openai = usable(this.status.openai);
    const rejected = [
      this.status.jev.reason === "authentication_failed"
        ? "Jev key rejected"
        : "",
      this.status.openai.reason === "authentication_failed"
        ? "OpenAI key rejected"
        : "",
    ].filter(Boolean);
    if (jev || openai) {
      this.lastMessage = `${jev ? "Jev reactions" : "Rule-based reactions"} · ${openai ? "nano planning" : "rule-based planning"}`;
    } else if (rejected.length) {
      this.lastMessage = "Rules only";
    } else if (!this.status.jev.configured && !this.status.openai.configured) {
      this.lastMessage = "Rules only · AI keys not configured";
    } else if (
      [this.status.jev, this.status.openai].every(
        (p) => !p.configured || p.calls >= p.limit,
      )
    ) {
      this.lastMessage = "Rules only · session AI budget reached";
    } else {
      this.lastMessage = "Rules only · AI retrying shortly";
    }
    if (rejected.length) this.lastMessage += ` · ${rejected.join(" · ")}`;
  }
}
