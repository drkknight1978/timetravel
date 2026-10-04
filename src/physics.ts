import {
  BODY_HEIGHT,
  alive,
  DT,
  HEIGHT,
  bodyRadius,
  bodyHeight,
  WIDTH,
  DEPTH,
  overlap,
  type Actor,
  type Command,
  type Vec3,
} from "./model";
import { Voxels } from "./world";
const EPS = 0.00001;
export function intersectingBlocks(
  v: Voxels,
  p: Vec3 & Partial<Pick<Actor, "kind" | "role">>,
): Set<number> {
  const result = new Set<number>(),
    radius = bodyRadius(p),
    height = bodyHeight(p);
  for (
    let x = Math.floor(p.x - radius + EPS);
    x <= Math.floor(p.x + radius - EPS);
    x++
  )
    for (
      let z = Math.floor(p.z - radius + EPS);
      z <= Math.floor(p.z + radius - EPS);
      z++
    )
      for (
        let y = Math.floor(p.y + EPS);
        y <= Math.floor(p.y + height - EPS);
        y++
      )
        if (v.get(x, y, z)) result.add(Voxels.index(x, y, z));
  return result;
}
export function blocked(
  v: Voxels,
  p: Vec3 & Partial<Pick<Actor, "kind" | "role">>,
  actors: Actor[],
  skipId: number,
  ignored?: Set<number>,
): boolean {
  const radius = bodyRadius(p),
    height = bodyHeight(p);
  if (
    p.x < radius ||
    p.x > WIDTH - radius ||
    p.z < radius ||
    p.z > DEPTH - radius ||
    p.y < 1 ||
    p.y + height > HEIGHT
  )
    return true;
  for (const i of intersectingBlocks(v, p)) if (!ignored?.has(i)) return true;
  return actors.some((a) => a.id !== skipId && alive(a) && overlap(a, p));
}
export function moveActor(
  v: Voxels,
  a: Actor,
  c: Command,
  actors: Actor[],
  ignored?: Set<number>,
  skipId = a.id,
): void {
  a.yaw = c.yaw;
  a.pitch = c.pitch;
  const length = Math.hypot(c.mx, c.mz),
    speed = c.sprint ? 7 : 4.3;
  const mx = length > 0 ? (c.mx / Math.max(1, length)) * speed * DT : 0,
    mz = length > 0 ? (c.mz / Math.max(1, length)) * speed * DT : 0;
  const ox = a.x,
    oz = a.z;
  if (c.jump && a.grounded) {
    a.vy = 7.8;
    a.grounded = false;
  }
  for (const [axis, amount] of [
    ["x", mx],
    ["z", mz],
  ] as const) {
    if (!amount) continue;
    const p = { x: a.x, y: a.y, z: a.z, kind: a.kind, role: a.role };
    p[axis] += amount;
    if (!blocked(v, p, actors, skipId, ignored)) a[axis] = p[axis];
    else if (
      (a.kind === "worker" || a.kind === "animal" || a.kind === "enemy") &&
      a.grounded
    ) {
      p.y += 1.001;
      if (
        !blocked(v, p, actors, skipId, ignored) &&
        !blocked(
          v,
          { x: a.x, y: p.y, z: a.z, kind: a.kind, role: a.role },
          actors,
          skipId,
          ignored,
        )
      ) {
        a[axis] = p[axis];
        a.y = p.y;
        a.grounded = false;
      }
    }
  }
  a.vy = Math.max(-30, a.vy - 22 * DT);
  const distance = a.vy * DT,
    steps = Math.max(1, Math.ceil(Math.abs(distance) / 0.15));
  a.grounded = false;
  for (let i = 0; i < steps; i++) {
    const p = {
      x: a.x,
      y: a.y + distance / steps,
      z: a.z,
      kind: a.kind,
      role: a.role,
    };
    if (!blocked(v, p, actors, skipId, ignored)) {
      a.y = p.y;
      continue;
    }
    // Binary search the free fraction so characters rest on the actual surface.
    let lo = 0,
      hi = 1;
    for (let j = 0; j < 12; j++) {
      const mid = (lo + hi) / 2;
      p.y = a.y + (distance / steps) * mid;
      if (blocked(v, p, actors, skipId, ignored)) hi = mid;
      else lo = mid;
    }
    a.y += (distance / steps) * lo;
    a.grounded = distance < 0;
    a.vy = 0;
    break;
  }
  a.moving = Math.hypot(a.x - ox, a.z - oz) > 0.001;
  if (ignored) {
    const now = intersectingBlocks(v, a);
    for (const i of ignored) if (!now.has(i)) ignored.delete(i);
  }
}
export function findPath(
  v: Voxels,
  start: Vec3,
  goal: Vec3,
  occupied: ReadonlySet<number> = new Set(),
): readonly number[] {
  const sx = Math.floor(start.x),
    sz = Math.floor(start.z),
    gx = Math.floor(goal.x),
    gz = Math.floor(goal.z);
  const root = sx + sz * WIDTH,
    target = gx + gz * WIDTH;
  if (root === target) return [target];
  const previous = new Int32Array(WIDTH * DEPTH).fill(-1),
    queue = [root];
  previous[root] = root;
  for (let head = 0; head < queue.length && head < 4096; head++) {
    const cell = queue[head],
      x = cell % WIDTH,
      z = Math.floor(cell / WIDTH),
      y = v.ground(x, z);
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx,
        nz = z + dz,
        n = nx + nz * WIDTH;
      if (
        nx < 1 ||
        nx >= WIDTH - 1 ||
        nz < 1 ||
        nz >= DEPTH - 1 ||
        previous[n] !== -1 ||
        occupied.has(n)
      )
        continue;
      const ny = v.ground(nx, nz);
      if (Math.abs(ny - y) > 1 || ny + BODY_HEIGHT >= HEIGHT) continue;
      previous[n] = cell;
      if (n === target) {
        const path = [n];
        let cur = cell;
        while (cur !== root) {
          path.push(cur);
          cur = previous[cur];
        }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return [];
}
