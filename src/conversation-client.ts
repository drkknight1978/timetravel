import { alive, bodyHeight } from "./model";
import { workerActivity } from "./crew";
import type { Simulation } from "./simulation";
import type { Temporal } from "./temporal";
import {
  CONVERSATION_PROFILES,
  MAX_EXCHANGES,
  MAX_SESSION_EXCHANGES,
  MAX_MESSAGE,
  MAX_REPLY,
  localConversationReply,
  type ConversationRequest,
  type ConversationResponse,
  type ConversationStatus,
  type ConversationTurn,
  type ConversationSource,
} from "./conversation-contract";
export interface ConversationMessage {
  readonly role: "player" | "npc";
  readonly text: string;
  readonly source?: ConversationSource;
  readonly historical?: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function statusOf(v: unknown): ConversationStatus | undefined {
  if (
    !object(v) ||
    typeof v.configured !== "boolean" ||
    typeof v.available !== "boolean" ||
    !Number.isSafeInteger(v.calls) ||
    (v.calls as number) < 0 ||
    !Number.isSafeInteger(v.limit) ||
    (v.limit as number) < 0 ||
    typeof v.reason !== "string" ||
    v.reason.length > 100 ||
    typeof v.model !== "string" ||
    v.model.length > 80 ||
    typeof v.estimatedCostUsd !== "number" ||
    !Number.isFinite(v.estimatedCostUsd) ||
    v.estimatedCostUsd < 0
  )
    return;
  return v as unknown as ConversationStatus;
}
function responseOf(
  v: unknown,
  r: ConversationRequest,
): ConversationResponse | undefined {
  if (
    !object(v) ||
    v.epoch !== r.epoch ||
    v.tick !== r.tick ||
    v.npcId !== r.npcId ||
    v.playerId !== r.playerId ||
    (v.source !== "openai" && v.source !== "local") ||
    typeof v.reply !== "string" ||
    !v.reply.trim() ||
    v.reply.length > MAX_REPLY ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.reply)
  )
    return;
  const status = statusOf(v.status);
  return status
    ? {
        epoch: r.epoch,
        tick: r.tick,
        npcId: r.npcId,
        playerId: r.playerId,
        reply: v.reply.trim(),
        source: v.source,
        status,
      }
    : undefined;
}
function statusNotice(status?: ConversationStatus): string {
  if (!status)
    return "Local dialogue · the conversation service is unavailable.";
  if (status.reason === "authentication_failed")
    return "Local dialogue · OpenAI rejected the key. Update it locally and restart the game server.";
  if (!status.configured)
    return "Local dialogue · add an OpenAI key locally to enable generated conversations.";
  if (status.reason === "session_limit")
    return "Local dialogue · this server’s conversation limit has been reached.";
  if (status.reason === "rate_limited" || status.reason === "busy")
    return "Local dialogue · please leave a moment between messages.";
  if (!status.available)
    return "Local dialogue · generated replies are temporarily unavailable.";
  return "Generated conversations · GPT-4.1 nano · recent messages are sent only when you press Send.";
}

/** One paused conversation. Completed exchanges commit when the panel closes. */
export class ConversationSession {
  private readonly epoch: number;
  private readonly tick: number;
  private readonly playerId: number;
  private readonly previous: readonly ConversationTurn[];
  private readonly completed: ConversationTurn[] = [];
  private readonly transcript: ConversationMessage[] = [];
  private disposed = false;
  private controller?: AbortController;
  private statusController?: AbortController;
  private status?: ConversationStatus;
  pending = false;
  notice = "Checking conversation connection…";
  constructor(
    private readonly sim: Simulation,
    private readonly temporal: Temporal,
    readonly npcId: number,
    private readonly changed: () => void,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly enabled: () => boolean = () => true,
  ) {
    this.epoch = sim.epoch;
    this.tick = sim.tick;
    this.playerId = sim.playerId;
    this.previous = sim.camp.conversations[npcId] ?? [];
    for (const turn of this.previous)
      this.transcript.push(
        { role: "player", text: turn.player, historical: true },
        { role: "npc", text: turn.npc, source: turn.source, historical: true },
      );
    if (!this.current())
      this.notice =
        "This conversation is no longer available. Return to the clearing.";
    else if (!enabled())
      this.notice = "Local dialogue · NPC AI is switched off.";
    else void this.loadStatus();
  }
  get messages(): readonly ConversationMessage[] {
    return this.transcript;
  }
  get disabled(): boolean {
    return !this.current() || this.completed.length >= MAX_SESSION_EXCHANGES;
  }
  private current(): boolean {
    const npc = this.sim.actors.find((a) => a.id === this.npcId);
    return (
      !this.disposed &&
      !!CONVERSATION_PROFILES[this.npcId] &&
      this.temporal.mode === "live" &&
      this.sim.epoch === this.epoch &&
      this.sim.tick === this.tick &&
      this.sim.playerId === this.playerId &&
      alive(this.sim.player) &&
      !!npc &&
      npc.kind === "worker" &&
      alive(npc) &&
      this.sim.canReach(this.sim.player, {
        x: npc.x,
        y: npc.y + bodyHeight(npc) * 0.65,
        z: npc.z,
      })
    );
  }
  private async request(
    url: string,
    controller: AbortController,
    body?: ConversationRequest,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fetcher = this.fetcher;
      return await Promise.race([
        (async () => {
          const r = await fetcher(url, {
            method: body ? "POST" : "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
            ...(body
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              : {}),
          });
          if (!r.ok) throw Error("conversation_unavailable");
          return r.json() as Promise<unknown>;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort("timeout");
              reject(Error("timeout"));
            },
            body ? 9000 : 3500,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async loadStatus() {
    const controller = new AbortController();
    this.statusController = controller;
    try {
      const value = await this.request("/api/npc-talk/status", controller);
      if (!this.current() || controller.signal.aborted || this.pending) return;
      this.status = statusOf(value);
      this.notice = statusNotice(this.status);
    } catch {
      if (
        this.current() &&
        (!controller.signal.aborted ||
          controller.signal.reason === "timeout") &&
        !this.pending
      )
        this.notice = statusNotice();
    } finally {
      if (this.current()) this.changed();
    }
  }
  async send(text: string): Promise<void> {
    if (this.pending || this.disabled) return;
    const message = text.trim();
    if (
      !message ||
      message.length > MAX_MESSAGE ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)
    ) {
      this.notice = `Write a message of 1–${MAX_MESSAGE} characters.`;
      this.changed();
      return;
    }
    this.statusController?.abort();
    const npc = this.sim.actors.find((a) => a.id === this.npcId)!;
    const request: ConversationRequest = {
      epoch: this.epoch,
      tick: this.tick,
      npcId: this.npcId,
      playerId: this.playerId,
      message,
      history: [...this.previous, ...this.completed].slice(-MAX_EXCHANGES),
      context: {
        activity: workerActivity(npc, this.sim.jobs),
        requestState: this.sim.camp.requests[this.npcId - 2],
        supplies: this.sim.camp.bag.slice(0, 4),
        health: this.sim.player.combat?.health ?? 100,
        nearbyEnemies: this.sim.actors.filter(
          (a) =>
            a.kind === "enemy" &&
            alive(a) &&
            Math.hypot(a.x - npc.x, a.z - npc.z) < 12,
        ).length,
        echoes: this.sim.actors.filter((a) => a.kind === "echo" && alive(a))
          .length,
        branch: this.temporal.branch,
      },
    };
    this.pending = true;
    this.transcript.push({ role: "player", text: message });
    this.notice = `${CONVERSATION_PROFILES[this.npcId].name} is considering your words…`;
    this.changed();
    const controller = new AbortController();
    this.controller = controller;
    let reply = localConversationReply(request),
      source: ConversationSource = "local";
    try {
      if (this.enabled()) {
        const result = responseOf(
          await this.request("/api/npc-talk/message", controller, request),
          request,
        );
        if (!result) throw Error("invalid_response");
        reply = result.reply;
        source = result.source;
        this.status = result.status;
        this.notice =
          source === "openai"
            ? "Generated reply · GPT-4.1 nano · recent exchanges stay in this timeline."
            : statusNotice(this.status);
      } else this.notice = "Local dialogue · NPC AI is switched off.";
    } catch {
      this.notice = statusNotice();
    }
    if (!this.current() || (controller.signal.aborted && this.disposed)) {
      this.pending = false;
      return;
    }
    this.completed.push(
      Object.freeze({
        player: message,
        npc: reply,
        source,
        tick: this.tick,
        playerId: this.playerId,
      }),
    );
    this.transcript.push({ role: "npc", text: reply, source });
    this.pending = false;
    this.controller = undefined;
    if (this.completed.length >= MAX_SESSION_EXCHANGES)
      this.notice =
        "A good place to pause. Return to the clearing and talk again later.";
    this.changed();
  }
  dispose(): void {
    if (this.disposed) return;
    if (this.current() && this.completed.length)
      this.sim.queueConversation({
        epoch: this.epoch,
        tick: this.tick,
        npcId: this.npcId,
        playerId: this.playerId,
        turns: this.completed,
      });
    this.disposed = true;
    this.controller?.abort();
    this.statusController?.abort();
    this.pending = false;
  }
}
