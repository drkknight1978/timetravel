import {
  alive,
  bodyHeight,
  bodyRadius,
  idle,
  type Actor,
  type CombatEffect,
  type CombatState,
  type Command,
  type Vec3,
} from "./model";
import { enemyIntention } from "./intelligence";
import type { Simulation } from "./simulation";
import { raycast } from "./world";

export const WEAPONS = [
  { name: "Builder's hand", damage: 0, range: 0, cooldown: 0 },
  { name: "Sword", damage: 32, range: 2.8, cooldown: 27 },
  { name: "Crossbow", damage: 24, range: 24, cooldown: 48 },
] as const;
export const ENEMIES = [
  {
    name: "Raider",
    health: 55,
    damage: 14,
    range: 2.35,
    windup: 25,
    recovery: 42,
    speed: 0.88,
    x: 35.5,
    z: 16.5,
  },
  {
    name: "Warden",
    health: 110,
    damage: 32,
    range: 3.1,
    windup: 66,
    recovery: 70,
    speed: 0.4,
    x: 43.5,
    z: 14.5,
  },
  {
    name: "Hunter",
    health: 70,
    damage: 16,
    range: 16,
    windup: 50,
    recovery: 90,
    speed: 0.64,
    x: 49.5,
    z: 19.5,
  },
] as const;

// Bounded flyweight cache shares repeated guard/weapon states without retaining an
// unbounded list of old fights. Historical frames own any states still needed.
const stateCache = new Map<string, CombatState>();
/** Copy-on-write state prevents later hits from mutating a historical snapshot. */
export function setCombat(a: Actor, patch: Partial<CombatState>): void {
  if (!a.combat) return;
  if (
    Object.entries(patch).every(
      ([k, v]) => a.combat![k as keyof CombatState] === v,
    )
  )
    return;
  const next = { ...a.combat, ...patch };
  const key = `${next.health}/${next.weapon}/${next.readyAt}/${next.hurtAt}/${+next.guarding}`;
  const cached = stateCache.get(key);
  if (cached) {
    a.combat = cached;
    return;
  }
  a.combat = Object.freeze(next);
  stateCache.set(key, a.combat);
  if (stateCache.size > 512) stateCache.delete(stateCache.keys().next().value!);
}
export function aim(a: Actor): Vec3 {
  return {
    x: -Math.sin(a.yaw) * Math.cos(a.pitch),
    y: Math.sin(a.pitch),
    z: -Math.cos(a.yaw) * Math.cos(a.pitch),
  };
}
const eye = (a: Actor): Vec3 => ({
  x: a.x,
  y: a.y + Math.min(1.58, bodyHeight(a) * 0.9),
  z: a.z,
});
const middle = (a: Actor): Vec3 => ({
  x: a.x,
  y: a.y + bodyHeight(a) * 0.55,
  z: a.z,
});
const separation = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function clearSight(sim: Simulation, from: Vec3, to: Vec3): boolean {
  const d = separation(from, to);
  return (
    d < 0.01 ||
    !raycast(
      sim.voxels,
      from,
      {
        x: (to.x - from.x) / d,
        y: (to.y - from.y) / d,
        z: (to.z - from.z) / d,
      },
      Math.max(0, d - 0.01),
    )
  );
}
/** Exact ray/AABB intersection, so close characters and new walls intercept shots. */
function rayBody(
  origin: Vec3,
  direction: Vec3,
  a: Actor,
  max: number,
): number | undefined {
  const radius = bodyRadius(a),
    lo = { x: a.x - radius, y: a.y, z: a.z - radius },
    hi = { x: a.x + radius, y: a.y + bodyHeight(a), z: a.z + radius };
  let near = 0,
    far = max;
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return;
    } else {
      let a0 = (lo[axis] - origin[axis]) / direction[axis],
        a1 = (hi[axis] - origin[axis]) / direction[axis];
      if (a0 > a1) [a0, a1] = [a1, a0];
      near = Math.max(near, a0);
      far = Math.min(far, a1);
      if (near > far) return;
    }
  }
  return near;
}
function emit(
  sim: Simulation,
  kind: CombatEffect["kind"],
  a: Actor,
  from: Vec3,
  to: Vec3,
) {
  sim.effects.push({ kind, from, to, tick: sim.tick, actorId: a.id });
}
function hostile(a: Actor, b: Actor): boolean {
  return a.kind === "enemy"
    ? b.kind === "player" || b.kind === "echo"
    : b.kind === "enemy";
}
function damage(
  sim: Simulation,
  source: Actor,
  target: Actor,
  amount: number,
): void {
  if (!target.combat || !hostile(source, target)) return;
  const dx = source.x - target.x,
    dz = source.z - target.z,
    d = Math.hypot(dx, dz);
  const inFront =
    d > 0 &&
    (-Math.sin(target.yaw) * dx - Math.cos(target.yaw) * dz) / d > 0.35;
  const shield =
    target.kind === "enemy" && target.role === 1 && target.task !== 2;
  const guarded = inFront && (target.combat.guarding || shield);
  if (guarded)
    amount = Math.max(1, Math.round(amount * (shield ? 0.25 : 0.18)));
  const health = Math.max(0, target.combat.health - amount);
  setCombat(target, {
    health,
    hurtAt: sim.tick,
    guarding: health > 0 && target.combat.guarding,
  });
  emit(
    sim,
    guarded ? "guard" : health === 0 ? "defeat" : "hit",
    source,
    eye(source),
    middle(target),
  );
  if (health === 0) {
    target.moving = false;
    if (target.id === sim.playerId)
      sim.feedback.push(
        "Defeated — press Q, then rewind to before the hit. Your history is still here.",
      );
    else if (target.kind === "enemy")
      sim.feedback.push(
        `${ENEMIES[target.role].name} defeated. Rewind to change this encounter.`,
      );
  }
}
export function resolveCombat(
  sim: Simulation,
  a: Actor,
  command: Command,
): void {
  if (!a.combat || !alive(a)) return;
  const selected = command.weapon ?? a.combat.weapon;
  const weapon =
    Number.isInteger(selected) && selected >= 0 && selected <= 2 ? selected : 0;
  const guarding =
    weapon === 1 &&
    !!command.guard &&
    !command.attack &&
    !command.sprint &&
    sim.tick >= a.combat.readyAt;
  setCombat(a, { weapon, guarding });
  if (!command.attack || weapon === 0 || sim.tick < a.combat.readyAt) return;
  const enemy = a.kind === "enemy" ? ENEMIES[a.role] : undefined;
  const spec = WEAPONS[weapon],
    range = enemy?.range ?? spec.range,
    amount = enemy?.damage ?? spec.damage;
  setCombat(a, {
    readyAt: sim.tick + (enemy?.recovery ?? spec.cooldown),
    guarding: false,
  });
  const origin = eye(a),
    direction = aim(a);
  let target: Actor | undefined,
    targetDistance: number = range,
    point: Vec3 | undefined;
  if (weapon === 2) {
    for (const b of sim.actors) {
      if (b.id === a.id || !alive(b)) continue;
      const d = rayBody(origin, direction, b, range);
      if (d !== undefined && d < targetDistance) {
        target = b;
        targetDistance = d;
      }
    }
    point = {
      x: origin.x + direction.x * targetDistance,
      y: origin.y + direction.y * targetDistance,
      z: origin.z + direction.z * targetDistance,
    };
    if (!clearSight(sim, origin, point)) target = undefined;
    // Clamp the visible tracer to the first voxel, too.
    const wall = raycast(sim.voxels, origin, direction, targetDistance);
    if (wall) {
      const box = {
        ...a,
        x: wall.x + 0.5,
        y: wall.y,
        z: wall.z + 0.5,
        kind: "player" as const,
      };
      // The centre is sufficient for a short impact tracer; hit validation above is exact.
      point = { x: box.x, y: box.y + 0.5, z: box.z };
    }
  } else {
    for (const b of sim.actors) {
      if (b.id === a.id || !alive(b)) continue;
      const p = middle(b),
        dx = p.x - origin.x,
        dy = p.y - origin.y,
        dz = p.z - origin.z,
        d = Math.hypot(dx, dy, dz);
      if (
        d >= targetDistance ||
        d < 0.01 ||
        (dx * direction.x + dy * direction.y + dz * direction.z) / d < 0.7 ||
        !clearSight(sim, origin, p)
      )
        continue;
      target = b;
      targetDistance = d;
      point = p;
    }
  }
  emit(
    sim,
    weapon === 2 ? "bolt" : "slash",
    a,
    origin,
    point ?? {
      x: origin.x + direction.x * range,
      y: origin.y + direction.y * range,
      z: origin.z + direction.z * range,
    },
  );
  if (target) damage(sim, a, target, amount);
}

type Walk = (a: Actor, x: number, z: number, c: Command) => Command;
/** All decisions and telegraph deadlines are stored on the actor and rewind exactly. */
export function enemyCommand(sim: Simulation, a: Actor, walk: Walk): Command {
  const c = idle(a),
    spec = ENEMIES[a.role];
  if (!alive(a)) return c;
  if (a.task === 2) {
    if (sim.tick >= a.taskUntil) {
      a.task = 3;
      a.taskUntil = sim.tick + spec.recovery;
      a.taskStep = (a.taskStep + 1) % 16;
      c.weapon = a.role === 2 ? 2 : 1;
      c.attack = true;
    }
    return c;
  }
  if (a.task === 3 && sim.tick < a.taskUntil) return c;
  let target: Actor | undefined,
    distance = 12;
  for (const b of sim.actors) {
    if (!alive(b) || (b.kind !== "player" && b.kind !== "echo")) continue;
    const d = separation(a, b);
    if (d < distance && clearSight(sim, eye(a), middle(b))) {
      target = b;
      distance = d;
    }
  }
  // The camp stays peaceful; foes pursue only around their northern home territory.
  if (!target || Math.hypot(a.x - spec.x, a.z - spec.z) > 15) {
    a.task = 0;
    a.cursor = 0;
    if (Math.hypot(a.x - spec.x, a.z - spec.z) > 1) {
      walk(a, spec.x, spec.z, c);
      c.mx *= spec.speed / 0.56;
      c.mz *= spec.speed / 0.56;
    }
    return c;
  }
  a.cursor = target.id;
  const p = middle(target),
    origin = eye(a),
    dx = p.x - origin.x,
    dy = p.y - origin.y,
    dz = p.z - origin.z;
  c.yaw = Math.atan2(-dx, -dz);
  c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const intention = enemyIntention(sim, a, target, c, walk, spec.speed);
  if (intention) return intention;
  const beginningRetreat = a.task !== 1;
  if (a.role === 2 && distance < 5) {
    if (beginningRetreat) a.taskUntil = sim.tick + 60;
    if (sim.tick < a.taskUntil) {
      a.task = 1;
      const norm = Math.max(0.1, Math.hypot(dx, dz));
      c.mx = (-dx / norm) * spec.speed;
      c.mz = (-dz / norm) * spec.speed;
      return c;
    }
  }
  a.task = 1;
  if (distance <= spec.range - 0.2 && sim.tick >= (a.combat?.readyAt ?? 0)) {
    a.task = 2;
    a.taskUntil = sim.tick + spec.windup;
    // Facing locks now. Dodging during the visible wind-up changes the result.
    return c;
  }
  if (a.role === 2 && distance < 5) {
    const norm = Math.max(0.1, Math.hypot(dx, dz));
    c.mx = (-dx / norm) * spec.speed;
    c.mz = (-dz / norm) * spec.speed;
  } else {
    walk(a, target.x, target.z, c);
    c.mx *= spec.speed / 0.56;
    c.mz *= spec.speed / 0.56;
  }
  return c;
}
