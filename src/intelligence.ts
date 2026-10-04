import { alive, bodyHeight, idle, type Actor, type Command } from "./model";
import type {
  AIAction,
  AIResponse,
  NPCObservation,
  NpcIntent,
} from "./ai-contract";
import type { Simulation } from "./simulation";
import { blocked } from "./physics";
import { raycast } from "./world";

export const INTENT_LABELS: Record<AIAction, string> = {
  routine: "Following their routine",
  watch: "Watching you carefully",
  flee: "Moving away from danger",
  investigate: "Investigating the commotion",
  engage: "Closing in",
  flank_left: "Circling to your left",
  flank_right: "Circling to your right",
  retreat: "Falling back",
  hold: "Holding a good position",
};
export function activeIntent(a: Actor, tick: number): NpcIntent | undefined {
  if (a.instinct && a.instinct.until > tick && a.instinct.action !== "routine")
    return a.instinct;
  if (a.plan && a.plan.until > tick && a.plan.action !== "routine")
    return a.plan;
  return undefined;
}
function sight(sim: Simulation, a: Actor, b: Actor): boolean {
  const from = { x: a.x, y: a.y + Math.min(1.5, bodyHeight(a) * 0.85), z: a.z };
  const dx = b.x - from.x,
    dy = b.y + bodyHeight(b) * 0.6 - from.y,
    dz = b.z - from.z,
    d = Math.hypot(dx, dy, dz);
  return (
    d < 0.01 ||
    !raycast(
      sim.voxels,
      from,
      { x: dx / d, y: dy / d, z: dz / d },
      Math.max(0, d - 0.05),
    )
  );
}
const distance = (a: Actor, b: Actor) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const round = (n: number) => Math.round(n * 10) / 10;
export function observeNPCs(sim: Simulation): NPCObservation[] {
  const players = sim.actors.filter(
    (a) => alive(a) && (a.kind === "player" || a.kind === "echo"),
  );
  if (!alive(sim.player)) return [];
  return sim.actors
    .filter(
      (a) =>
        alive(a) &&
        (a.kind === "worker" || a.kind === "enemy") &&
        distance(a, sim.player) < 26,
    )
    .map((a) => {
      const targets = players
        .filter((b) => sight(sim, a, b))
        .sort((b, c) => distance(a, b) - distance(a, c));
      const target = targets[0] ?? sim.player;
      // Workers fear enemies; enemies oppose players and their past selves.
      // Allied enemies count as allies, never as a nearer source of danger.
      const nearThreat =
        a.kind === "enemy"
          ? targets[0]
          : sim.actors
              .filter((b) => alive(b) && b.kind === "enemy" && sight(sim, a, b))
              .sort((b, c) => distance(a, b) - distance(a, c))[0];
      const d = distance(a, target),
        threatDistance = nearThreat
          ? Math.min(99, distance(a, nearThreat))
          : 99;
      const visible = targets.length > 0;
      const recentHit = sim.actors.some(
        (b) =>
          b.combat &&
          b.combat.hurtAt > 0 &&
          sim.tick - b.combat.hurtAt < 240 &&
          distance(a, b) < 12,
      );
      const options: AIAction[] =
        a.kind === "enemy"
          ? d < 12 && visible
            ? ["engage", "flank_left", "flank_right", "retreat", "hold"]
            : ["routine"]
          : threatDistance < 8
            ? ["routine", "flee", "watch"]
            : d < 10 &&
                visible &&
                (target.combat?.weapon || target.kind === "echo" || recentHit)
              ? ["routine", "watch", "investigate"]
              : ["routine"];
      const advance = {
        x: a.x - Math.sin(a.yaw) * 0.65,
        y: a.y,
        z: a.z - Math.cos(a.yaw) * 0.65,
        kind: a.kind,
        role: a.role,
      };
      return {
        actorId: a.id,
        kind: a.kind as "worker" | "enemy",
        role: a.role,
        health: a.combat?.health ?? 100,
        position: { x: round(a.x), y: round(a.y), z: round(a.z) },
        targetId: target.id,
        targetDistance: round(Math.min(99, d)),
        threatDistance: round(threatDistance),
        visible,
        blocked: blocked(sim.voxels, advance, sim.actors, a.id),
        allies: sim.actors.filter(
          (b) =>
            b.id !== a.id &&
            b.kind === a.kind &&
            alive(b) &&
            distance(a, b) < 7,
        ).length,
        playerArmed: !!target.combat?.weapon,
        playerHealth: target.combat?.health ?? 0,
        echoes: players.filter((b) => b.kind === "echo").length,
        currentAction: activeIntent(a, sim.tick)?.action ?? "routine",
        options,
      };
    })
    .slice(0, 7);
}
/** Only accepted decisions enter simulation state, at a fixed tick boundary. */
export function applyAIResponse(sim: Simulation, response: AIResponse): void {
  if (
    !Array.isArray(response.decisions) ||
    !Number.isInteger(response.tick) ||
    response.tick < 0 ||
    response.epoch !== sim.epoch ||
    response.tick > sim.tick ||
    sim.tick - response.tick > 300 ||
    (response.layer !== "instinct" && response.layer !== "plan") ||
    response.source !== (response.layer === "instinct" ? "jev" : "openai")
  )
    return;
  const observations = new Map(observeNPCs(sim).map((o) => [o.actorId, o]));
  const seen = new Set<number>();
  for (const decision of response.decisions.slice(0, 7)) {
    if (!decision || typeof decision !== "object") continue;
    const o = observations.get(decision.actorId),
      a = sim.actors.find((b) => b.id === decision.actorId);
    if (
      !o ||
      !a ||
      seen.has(a.id) ||
      !o.options.includes(decision.action) ||
      typeof decision.reason !== "string" ||
      decision.reason.length > 96
    )
      continue;
    if (
      response.source === "jev" &&
      (!Number.isFinite(decision.confidence) ||
        decision.confidence! < 0.6 ||
        decision.confidence! > 1)
    )
      continue;
    seen.add(a.id);
    const intent: NpcIntent = Object.freeze({
      action: decision.action,
      until: sim.tick + (response.layer === "instinct" ? 360 : 1800),
      source: response.source,
      reason: decision.reason,
      targetId: o.targetId,
    });
    if (response.layer === "instinct") a.instinct = intent;
    else a.plan = intent;
    a.nextPlan = 0;
  }
}
export type IntelligenceWalk = (
  a: Actor,
  x: number,
  z: number,
  c: Command,
) => Command;
/** Work orders from the player have priority; callers check them before this policy. */
export function workerIntention(
  sim: Simulation,
  a: Actor,
  walk: IntelligenceWalk,
): Command | undefined {
  const intent = activeIntent(a, sim.tick);
  if (!intent) return;
  const c = idle(a);
  const threat =
    intent.action === "watch" || intent.action === "flee"
      ? sim.actors
          .filter((b) => b.kind === "enemy" && alive(b) && sight(sim, a, b))
          .sort((b, d) => distance(a, b) - distance(a, d))[0]
      : undefined;
  const target =
    intent.action === "watch" && threat && distance(a, threat) < 9
      ? threat
      : sim.actors.find((b) => b.id === intent.targetId && alive(b));
  if (intent.action === "flee") {
    if (!threat || distance(a, threat) >= 9) return;
    const d = Math.max(0.1, Math.hypot(a.x - threat.x, a.z - threat.z));
    walk(
      a,
      Math.max(1.5, Math.min(62.5, a.x + ((a.x - threat.x) / d) * 4)),
      Math.max(1.5, Math.min(62.5, a.z + ((a.z - threat.z) / d) * 4)),
      c,
    );
    c.mx *= 1.4;
    c.mz *= 1.4;
    return c;
  }
  if (!target || distance(a, target) > 12 || !sight(sim, a, target)) return;
  c.yaw = Math.atan2(-(target.x - a.x), -(target.z - a.z));
  if (intent.action === "watch") return c;
  if (intent.action === "investigate") {
    const d = Math.max(0.1, Math.hypot(a.x - target.x, a.z - target.z));
    if (d > 3)
      walk(
        a,
        target.x + ((a.x - target.x) / d) * 2.5,
        target.z + ((a.z - target.z) / d) * 2.5,
        c,
      );
    return c;
  }
}
/** Tactical intentions never skip an attack telegraph or bypass collision. */
export function enemyIntention(
  sim: Simulation,
  a: Actor,
  target: Actor,
  c: Command,
  walk: IntelligenceWalk,
  speed: number,
): Command | undefined {
  const intent = activeIntent(a, sim.tick);
  if (!intent || intent.action === "engage") return;
  const dx = target.x - a.x,
    dz = target.z - a.z,
    d = Math.max(0.1, Math.hypot(dx, dz));
  const look = c.yaw;
  if (intent.action === "retreat") {
    if (d > 8) return;
    walk(
      a,
      Math.max(1.5, Math.min(62.5, a.x - (dx / d) * 4)),
      Math.max(1.5, Math.min(62.5, a.z - (dz / d) * 4)),
      c,
    );
  } else if (
    intent.action === "flank_left" ||
    intent.action === "flank_right"
  ) {
    if (d < 1.8) return;
    const side = intent.action === "flank_left" ? -1 : 1;
    walk(
      a,
      Math.max(
        1.5,
        Math.min(62.5, target.x + (dz / d) * 3 * side - (dx / d) * 1.5),
      ),
      Math.max(
        1.5,
        Math.min(62.5, target.z - (dx / d) * 3 * side - (dz / d) * 1.5),
      ),
      c,
    );
  } else if (intent.action === "hold") {
    // Hold changes spacing, not the ability to attack inside normal weapon range.
    const range = a.role === 2 ? 15.8 : a.role === 1 ? 2.9 : 2.15;
    if (d <= range) return;
    return c;
  } else return;
  c.mx *= speed / 0.56;
  c.mz *= speed / 0.56;
  c.yaw = look;
  a.task = 1;
  return c;
}
