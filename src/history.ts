import {
  copyActor,
  HISTORY_TICKS,
  idle,
  type Actor,
  type Command,
  type CombatState,
  type Delta,
  type RecordedCommand,
  type Snapshot,
} from "./model";
import type { NpcIntent } from "./ai-contract";
import type { ConversationTurn } from "./conversation-contract";
import { Simulation } from "./simulation";
const STRIDE = 12,
  COMMAND_STRIDE = 8;
const META_BASE = 2 ** 26;
const KINDS = ["player", "echo", "worker", "animal", "enemy"] as const;
export interface Frame {
  tick: number;
  playerId: number;
  rng: number;
  actors: Float64Array;
  paths: (readonly number[])[];
  combat: readonly (CombatState | undefined)[];
  intents: readonly (NpcIntent | undefined)[];
  jobs: Int32Array;
  commands: Float64Array;
  deltas: Uint32Array;
  checkpoint?: Uint8Array | Uint32Array;
  arrivals: number[];
  camp: Snapshot["camp"];
}
// Full checkpoints use run-length encoding when it is smaller than the raw voxel array.
export function compressVoxels(data: Uint8Array): Uint8Array | Uint32Array {
  const runs: number[] = [];
  for (let i = 0; i < data.length;) {
    const value = data[i];
    let end = i + 1;
    while (end < data.length && data[end] === value) end++;
    runs.push(((end - i) << 8) | value);
    i = end;
  }
  return runs.length * 4 < data.length ? new Uint32Array(runs) : data.slice();
}
export function expandVoxels(
  data: Uint8Array | Uint32Array,
  size: number,
): Uint8Array {
  if (data instanceof Uint8Array) return data;
  const result = new Uint8Array(size);
  let cursor = 0;
  for (const run of data) {
    const length = run >>> 8;
    result.fill(run & 255, cursor, cursor + length);
    cursor += length;
  }
  return result;
}
function pack(
  s: Snapshot,
  commands: RecordedCommand[],
  deltas: Delta[],
): Frame {
  const actors = new Float64Array(s.actors.length * STRIDE),
    paths: (readonly number[])[] = [];
  s.actors.forEach((a, i) => {
    actors.set(
      [
        a.id,
        (KINDS.indexOf(a.kind) |
          (+a.grounded << 3) |
          (+a.moving << 4) |
          (a.role << 5) |
          ((a.site + 1) << 7) |
          (a.task << 10) |
          (a.taskStep << 14) |
          (a.cargo << 18)) +
          a.waypoint * META_BASE,
        a.x,
        a.y,
        a.z,
        a.vy,
        a.yaw,
        a.pitch,
        a.program + a.cursor * META_BASE,
        a.nextPlan,
        a.birth,
        a.taskUntil,
      ],
      i * STRIDE,
    );
    paths.push(a.path);
  });
  const jobs = new Int32Array(s.jobs.length * 4);
  s.jobs.forEach((j, i) =>
    jobs.set([j.phase, j.index, j.waitUntil, j.cycle], i * 4),
  );
  const packed = new Float64Array(commands.length * COMMAND_STRIDE);
  commands.forEach(({ actorId, command: c }, i) =>
    packed.set(
      [
        actorId,
        c.mx,
        c.mz,
        c.yaw,
        c.pitch,
        +c.jump |
          (+c.sprint << 1) |
          (+(c.attack ?? false) << 2) |
          (+(c.guard ?? false) << 3) |
          ((c.weapon === undefined ? 0 : c.weapon + 1) << 4),
        c.edit &&
        Number.isInteger(c.edit.x) &&
        Number.isInteger(c.edit.y) &&
        Number.isInteger(c.edit.z) &&
        c.edit.x >= 0 &&
        c.edit.x < 64 &&
        c.edit.y >= 0 &&
        c.edit.y < 32 &&
        c.edit.z >= 0 &&
        c.edit.z < 64
          ? c.edit.x +
            c.edit.z * 64 +
            c.edit.y * 4096 +
            c.edit.block * 2 ** 17 +
            (c.edit.expected ?? 255) * 2 ** 25
          : -1,
        c.action
          ? c.action.type +
            c.action.target * 32 +
            (c.action.value ?? 0) * 2 ** 23
          : -1,
      ],
      i * COMMAND_STRIDE,
    ),
  );
  const changes = new Uint32Array(deltas.length * 3);
  deltas.forEach((d, i) => changes.set([d.index, d.before, d.after], i * 3));
  return {
    tick: s.tick,
    playerId: s.playerId,
    rng: s.rng,
    actors,
    paths,
    combat: s.actors.map((a) => a.combat),
    intents: s.actors.flatMap((a) => [a.instinct, a.plan]),
    jobs,
    commands: packed,
    deltas: changes,
    arrivals: [],
    camp: s.camp,
  };
}
export function unpack(f: Frame): Snapshot {
  const actors: Actor[] = [];
  for (let i = 0; i < f.actors.length; i += STRIDE) {
    const a = f.actors;
    actors.push({
      id: a[i],
      kind: KINDS[a[i + 1] & 7],
      x: a[i + 2],
      y: a[i + 3],
      z: a[i + 4],
      vy: a[i + 5],
      yaw: a[i + 6],
      pitch: a[i + 7],
      grounded: !!(a[i + 1] & 8),
      moving: !!(a[i + 1] & 16),
      role: (a[i + 1] >>> 5) & 3,
      site: ((a[i + 1] >>> 7) & 7) - 1,
      task: (a[i + 1] >>> 10) & 15,
      taskStep: (a[i + 1] >>> 14) & 15,
      cargo: (a[i + 1] >>> 18) & 255,
      waypoint: Math.floor(a[i + 1] / META_BASE),
      program: a[i + 8] % META_BASE,
      cursor: Math.floor(a[i + 8] / META_BASE),
      nextPlan: a[i + 9],
      birth: a[i + 10],
      taskUntil: a[i + 11],
      path: f.paths[i / STRIDE],
      combat: f.combat[i / STRIDE],
      instinct: f.intents[(i / STRIDE) * 2],
      plan: f.intents[(i / STRIDE) * 2 + 1],
    });
  }
  const jobs = [];
  for (let i = 0; i < f.jobs.length; i += 4)
    jobs.push({
      phase: f.jobs[i],
      index: f.jobs[i + 1],
      waitUntil: f.jobs[i + 2],
      cycle: f.jobs[i + 3],
    });
  return {
    tick: f.tick,
    playerId: f.playerId,
    rng: f.rng,
    actors,
    jobs,
    camp: f.camp,
  };
}
function readCommand(f: Frame, id: number): Command | undefined {
  const p = f.commands;
  for (let i = 0; i < p.length; i += COMMAND_STRIDE)
    if (p[i] === id)
      return {
        mx: p[i + 1],
        mz: p[i + 2],
        yaw: p[i + 3],
        pitch: p[i + 4],
        jump: !!(p[i + 5] & 1),
        sprint: !!(p[i + 5] & 2),
        attack: !!(p[i + 5] & 4) || undefined,
        guard: !!(p[i + 5] & 8) || undefined,
        weapon: p[i + 5] >> 4 === 0 ? undefined : (p[i + 5] >> 4) - 1,
        edit:
          p[i + 6] < 0
            ? undefined
            : {
                x: p[i + 6] % 64,
                y: Math.floor(p[i + 6] / 4096) % 32,
                z: Math.floor(p[i + 6] / 64) % 64,
                block: Math.floor(p[i + 6] / 2 ** 17) % 256,
                expected:
                  Math.floor(p[i + 6] / 2 ** 25) === 255
                    ? undefined
                    : Math.floor(p[i + 6] / 2 ** 25),
              },
        action:
          p[i + 7] < 0
            ? undefined
            : {
                type: p[i + 7] % 32,
                target: Math.floor(p[i + 7] / 32) % 2 ** 18,
                value: Math.floor(p[i + 7] / 2 ** 23),
              },
      };
}
export interface TrailSegment {
  id: number;
  kind: number;
  from: number[];
  to: number[];
  future: boolean;
}
export class History {
  frames = new Map<number, Frame>();
  latest = 0;
  revision = 0;
  private minimumTick = 0;
  private combatIds = new WeakMap<CombatState, number>();
  private nextCombatId = 1;
  private combatArrays = new Map<string, Frame["combat"]>();
  constructor(
    readonly sim: Simulation,
    readonly windowTicks = HISTORY_TICKS,
  ) {
    this.record([], true);
  }
  get oldest(): number {
    return Math.max(this.minimumTick, this.latest - this.windowTicks);
  }
  record(
    commands: RecordedCommand[],
    forceCheckpoint = false,
    arrivals: number[] = [],
  ): void {
    const s = this.sim.snapshot(),
      previous = this.frames.get(s.tick);
    const f = pack(s, commands.length ? commands : [], this.sim.voxels.pending);
    const prior = previous ?? this.frames.get(s.tick - 1);
    if (
      prior &&
      f.intents.length === prior.intents.length &&
      f.intents.every((v, i) => v === prior.intents[i])
    )
      f.intents = prior.intents;
    if (
      prior &&
      f.combat.length === prior.combat.length &&
      f.combat.every((c, i) => c === prior.combat[i])
    )
      f.combat = prior.combat;
    if (f.combat !== prior?.combat) {
      const key = f.combat
        .map((c) => {
          if (!c) return 0;
          let id = this.combatIds.get(c);
          if (id === undefined) {
            id = this.nextCombatId++;
            this.combatIds.set(c, id);
          }
          return id;
        })
        .join("/");
      const cached = this.combatArrays.get(key);
      if (cached) f.combat = cached;
      else {
        this.combatArrays.set(key, f.combat);
        if (this.combatArrays.size > 512)
          this.combatArrays.delete(this.combatArrays.keys().next().value!);
      }
    }
    if (previous) {
      f.commands = previous.commands;
      f.deltas = previous.deltas;
    }
    if (forceCheckpoint || s.tick % 120 === 0)
      f.checkpoint = compressVoxels(this.sim.voxels.data);
    else if (previous?.checkpoint) f.checkpoint = previous.checkpoint;
    f.arrivals = [...new Set([...(previous?.arrivals ?? []), ...arrivals])];
    this.frames.set(s.tick, f);
    this.latest = s.tick;
    this.revision++;
    this.evict();
  }
  private evict(): void {
    let keep = 0;
    for (const [tick, f] of this.frames)
      if (tick <= this.oldest && f.checkpoint) keep = Math.max(tick, keep);
    for (const tick of this.frames.keys()) {
      if (tick < keep) this.frames.delete(tick);
      else break;
    }
    if (this.latest % 120 === 0) this.collectScripts();
  }
  collectScripts(): void {
    const refs = new Set<number>();
    for (const f of this.frames.values())
      for (let i = 0; i < f.actors.length; i += STRIDE)
        if ((f.actors[i + 1] & 7) === 1 && f.actors[i + 8] % META_BASE)
          refs.add(f.actors[i + 8] % META_BASE);
    for (const a of this.sim.actors)
      if (a.kind === "echo" && a.program) refs.add(a.program);
    for (const id of this.sim.replays.keys())
      if (!refs.has(id)) this.sim.replays.delete(id);
  }
  seek(tick: number): void {
    const target = Math.max(
        this.oldest,
        Math.min(this.latest, Math.round(tick)),
      ),
      frame = this.frames.get(target);
    if (!frame) throw Error(`No history at ${target}`);
    let current = this.sim.tick;
    if (Math.abs(target - current) > 240) {
      let checkpoint: Frame | undefined;
      for (const [t, f] of this.frames)
        if (t <= target && f.checkpoint && (!checkpoint || t > checkpoint.tick))
          checkpoint = f;
      if (!checkpoint) throw Error("History checkpoint missing");
      this.sim.voxels.restore(
        expandVoxels(checkpoint.checkpoint!, this.sim.voxels.data.length),
      );
      current = checkpoint.tick;
    }
    if (target < current)
      for (let t = current; t > target; t--) {
        const f = this.frames.get(t)!;
        for (let i = f.deltas.length - 3; i >= 0; i -= 3)
          this.sim.voxels.apply(
            {
              index: f.deltas[i],
              before: f.deltas[i + 1],
              after: f.deltas[i + 2],
            },
            false,
          );
      }
    else
      for (let t = current + 1; t <= target; t++) {
        const f = this.frames.get(t)!;
        for (let i = 0; i < f.deltas.length; i += 3)
          this.sim.voxels.apply(
            {
              index: f.deltas[i],
              before: f.deltas[i + 1],
              after: f.deltas[i + 2],
            },
            true,
          );
      }
    this.sim.restore(unpack(frame));
  }
  script(id: number, from: number, to: number): Command[] {
    const result: Command[] = [];
    for (let t = from + 1; t <= to; t++) {
      const f = this.frames.get(t);
      if (!f) break;
      const c = readCommand(f, id);
      if (!c) break;
      result.push(c);
    }
    return result;
  }
  truncate(tick: number): void {
    this.minimumTick = this.oldest;
    for (const t of this.frames.keys()) if (t > tick) this.frames.delete(t);
    this.latest = tick;
    this.revision++;
  }
  actorAt(tick: number, id: number): Actor | undefined {
    const f = this.frames.get(tick);
    return f ? unpack(f).actors.find((a) => a.id === id) : undefined;
  }
  trails(selected: number): TrailSegment[] {
    const result: TrailSegment[] = [],
      last = new Map<number, { pos: number[]; tick: number; kind: number }>();
    for (let t = this.oldest; t <= this.latest; t++) {
      const f = this.frames.get(t);
      if (!f) continue;
      // Arrival discontinuities must be processed even between the 5 Hz trail samples.
      for (const id of f.arrivals) last.delete(id);
      if (t % 12 !== 0 && t !== selected && t !== this.latest) continue;
      const present = new Set<number>();
      for (let i = 0; i < f.actors.length; i += STRIDE) {
        const a = f.actors,
          id = a[i],
          pos = [a[i + 2], a[i + 3] + 0.55, a[i + 4]],
          prev = last.get(id);
        present.add(id);
        if (
          prev &&
          Math.hypot(
            pos[0] - prev.pos[0],
            pos[1] - prev.pos[1],
            pos[2] - prev.pos[2],
          ) > 0.005
        )
          result.push({
            id,
            kind: a[i + 1] & 7,
            from: prev.pos,
            to: pos,
            future: t > selected,
          });
        last.set(id, { pos, tick: t, kind: a[i + 1] & 7 });
      }
      for (const id of last.keys()) if (!present.has(id)) last.delete(id);
    }
    return result;
  }
  arrivals(): { id: number; tick: number; x: number; y: number; z: number }[] {
    const markers = [];
    for (const [tick, f] of this.frames) {
      if (tick < this.oldest) continue;
      for (const id of f.arrivals) {
        const a = unpack(f).actors.find((a) => a.id === id);
        if (a) markers.push({ id, tick, x: a.x, y: a.y, z: a.z });
      }
    }
    return markers;
  }
  bytes(): number {
    let total = 0;
    const paths = new Set<readonly number[]>();
    const camps = new Set<Snapshot["camp"]>();
    const conversations = new Set<Snapshot["camp"]["conversations"]>();
    const memories = new Set<readonly ConversationTurn[]>();
    const exchanges = new Set<ConversationTurn>();
    const combatArrays = new Set<Frame["combat"]>(this.combatArrays.values());
    const combatStates = new Set<CombatState>();
    const intentArrays = new Set<Frame["intents"]>();
    const intents = new Set<NpcIntent>();
    for (const f of this.frames.values()) {
      total +=
        f.actors.byteLength +
        f.jobs.byteLength +
        f.commands.byteLength +
        f.deltas.byteLength +
        (f.checkpoint?.byteLength ?? 0) +
        1160 +
        f.paths.length * 8;
      for (const p of f.paths) paths.add(p);
      camps.add(f.camp);
      combatArrays.add(f.combat);
      intentArrays.add(f.intents);
    }
    for (const arr of combatArrays) {
      total += 32 + arr.length * 8;
      for (const state of arr) if (state) combatStates.add(state);
    }
    total += combatStates.size * 80;
    for (const arr of intentArrays) {
      total += 32 + arr.length * 8;
      for (const intent of arr) if (intent) intents.add(intent);
    }
    for (const intent of intents) total += 128 + intent.reason.length * 2;
    for (const p of paths) total += p.length * 8 + 24;
    for (const camp of camps) {
      total +=
        776 +
        Object.keys(camp.harvested).length * 16 +
        camp.feeders.length * 32;
      conversations.add(camp.conversations);
    }
    // Conversation graphs are immutable and shared between frames and camp edits.
    for (const conversation of conversations) {
      const entries = Object.values(conversation);
      total += 32 + entries.length * 16;
      for (const memory of entries) memories.add(memory);
    }
    for (const memory of memories) {
      total += 32 + memory.length * 8;
      for (const exchange of memory) exchanges.add(exchange);
    }
    for (const exchange of exchanges)
      total += 96 + (exchange.player.length + exchange.npc.length) * 2;
    for (const replay of this.sim.replays.values())
      total += replay.commands.length * 160 + 64;
    return total;
  }
}
export function advance(
  sim: Simulation,
  history: History,
  command = idle(sim.player),
): void {
  history.record(sim.step(command));
}
export function capturePlayer(sim: Simulation): Actor {
  return copyActor(sim.player);
}
