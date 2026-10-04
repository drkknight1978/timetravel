import {
  Block,
  DEPTH,
  HEIGHT,
  WIDTH,
  alive,
  copyActor,
  idle,
  type Actor,
  type Command,
} from "./model";
import { advance, History } from "./history";
import { blocked, intersectingBlocks, moveActor } from "./physics";
import { Simulation } from "./simulation";
export class Temporal {
  mode: "live" | "temporal" = "live";
  entryTick = 0;
  traveller: Actor;
  entryPlayer: Actor;
  ignored = new Set<number>();
  branch = 0;
  speed = 2;
  private previewRemainder = 0;
  constructor(
    readonly sim: Simulation,
    readonly history: History,
  ) {
    this.traveller = copyActor(sim.player);
    this.entryPlayer = copyActor(sim.player);
  }
  get view(): Actor {
    return this.mode === "live" ? this.sim.player : this.traveller;
  }
  enter(): void {
    if (this.mode === "temporal") return;
    this.history.record([]);
    this.entryTick = this.sim.tick;
    this.entryPlayer = copyActor(this.sim.player);
    this.traveller = copyActor(this.sim.player);
    this.traveller.id = -1;
    // The traveller can escape a defeat, while authoritative health stays historical.
    this.traveller.combat = undefined;
    this.mode = "temporal";
    this.previewRemainder = 0;
    this.ignored = intersectingBlocks(this.sim.voxels, this.traveller);
  }
  seek(tick: number): void {
    if (this.mode !== "temporal") return;
    this.history.seek(Math.min(tick, this.entryTick));
    this.ignored = intersectingBlocks(this.sim.voxels, this.traveller);
  }
  update(command: Command, previewDirection = 0): void {
    if (this.mode === "live") {
      advance(this.sim, this.history, command);
      return;
    }
    if (previewDirection) {
      this.previewRemainder += previewDirection * this.speed;
      const delta = Math.trunc(this.previewRemainder);
      this.previewRemainder -= delta;
      this.seek(this.sim.tick + delta);
    }
    moveActor(
      this.sim.voxels,
      this.traveller,
      { ...command, edit: undefined, action: undefined },
      this.sim.actors,
      this.ignored,
      this.sim.playerId,
    );
  }
  /** An explicit escape route when rewinding restores terrain around the traveller. */
  returnToSurface(): { ok: boolean; reason?: string } {
    if (this.mode !== "temporal")
      return {
        ok: false,
        reason: "Leave time with Q before returning to the surface.",
      };
    const past = this.sim.tick < this.entryTick;
    const colliders = this.sim.actors.filter(
      (a) => past || a.id !== this.sim.playerId,
    );
    const supports = new Set([
      Block.Grass,
      Block.Dirt,
      Block.Stone,
      Block.Path,
      Block.Bedrock,
      Block.Planks,
      Block.Sand,
      Block.Slate,
    ]);
    const candidates: { x: number; y: number; z: number; distance: number }[] =
      [];
    for (let x = 0; x < WIDTH; x++) {
      for (let z = 0; z < DEPTH; z++) {
        const px = x + 0.5,
          pz = z + 0.5,
          distance = Math.hypot(px - this.traveller.x, pz - this.traveller.z);
        if (distance < 1.2) continue;
        // Use the sky-facing surface, never a pocket beneath a restored ceiling.
        const y = this.sim.voxels.ground(x, z);
        if (
          y < 1 ||
          y + 2 > HEIGHT ||
          !supports.has(this.sim.voxels.get(x, y - 1, z))
        )
          continue;
        const position = { x: px, y, z: pz };
        if (blocked(this.sim.voxels, position, colliders, -1)) continue;
        candidates.push({ ...position, distance });
      }
    }
    // A local high surface takes us over the lip of a hole rather than to another
    // point on its floor. Expand only when the entire nearer area is obstructed.
    for (const radius of [6, 12, 24, Infinity]) {
      const nearby = candidates.filter((p) => p.distance <= radius);
      if (!nearby.length) continue;
      nearby.sort((a, b) => b.y - a.y || a.distance - b.distance);
      const destination = nearby[0];
      Object.assign(this.traveller, {
        x: destination.x,
        y: destination.y,
        z: destination.z,
        vy: 0,
        grounded: true,
        moving: false,
      });
      this.ignored.clear();
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "No clear ground is available. Preview another moment, or press C to cancel and restore your original position.",
    };
  }
  returnProblem(): string | undefined {
    if (!alive(this.sim.player))
      return "Rewind to before your defeat to return to the fight.";
    const past = this.sim.tick < this.entryTick;
    if (past && this.sim.actors.filter((a) => a.kind === "echo").length >= 3)
      return "Three past selves already exist here. Rewind before an earlier arrival, or cancel.";
    const colliders = this.sim.actors.filter(
      (a) => past || a.id !== this.sim.playerId,
    );
    if (blocked(this.sim.voxels, this.traveller, colliders, -1))
      return "This return point is occupied. Move into clear space, or press T to return to the surface.";
  }
  resume(): { ok: boolean; branched: boolean; reason?: string } {
    if (this.mode !== "temporal") return { ok: false, branched: false };
    const reason = this.returnProblem();
    if (reason) return { ok: false, branched: false, reason };
    const branched = this.sim.tick < this.entryTick;
    if (branched) {
      const historical = this.sim.player;
      const replay = this.sim.createReplay(
        this.history.script(historical.id, this.sim.tick, this.entryTick),
      );
      historical.kind = "echo";
      historical.program = replay.id;
      historical.cursor = 0;
      const newcomer = copyActor(this.traveller);
      newcomer.id = this.sim.nextId++;
      newcomer.kind = "player";
      newcomer.combat = historical.combat
        ? Object.freeze({ ...historical.combat, guarding: false })
        : undefined;
      newcomer.program = 0;
      newcomer.cursor = 0;
      newcomer.birth = this.sim.tick;
      newcomer.vy = 0;
      this.sim.actors.push(newcomer);
      this.sim.playerId = newcomer.id;
      this.branch++;
      this.history.truncate(this.sim.tick);
    } else {
      const p = this.sim.player;
      Object.assign(p, {
        x: this.traveller.x,
        y: this.traveller.y,
        z: this.traveller.z,
        yaw: this.traveller.yaw,
        pitch: this.traveller.pitch,
        vy: 0,
        grounded: this.traveller.grounded,
      });
    }
    this.sim.voxels.pending = [];
    this.history.record([], false, [this.sim.playerId]);
    this.history.collectScripts();
    this.mode = "live";
    return { ok: true, branched };
  }
  cancel(): void {
    if (this.mode !== "temporal") return;
    this.history.seek(this.entryTick);
    this.mode = "live";
  }
  stepIdle(): void {
    this.update(idle(this.view));
  }
}
export class FixedClock {
  accumulator = 0;
  private previous: number | undefined;
  frame(now: number, running: boolean, step: () => void): number {
    if (!running) {
      this.previous = undefined;
      this.accumulator = 0;
      return 0;
    }
    if (this.previous === undefined) {
      this.previous = now;
      return 0;
    }
    const elapsed = (now - this.previous) / 1000;
    this.previous = now;
    if (elapsed > 0.25 || elapsed < 0) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += elapsed;
    while (this.accumulator >= 1 / 60) {
      step();
      this.accumulator -= 1 / 60;
    }
    return this.accumulator * 60;
  }
  reset(): void {
    this.previous = undefined;
    this.accumulator = 0;
  }
}
