import type { NpcIntent } from "./ai-contract";
import type { Action, CampState } from "./camp";
export const WIDTH = 64,
  HEIGHT = 32,
  DEPTH = 64,
  CHUNK = 16;
export const HZ = 60,
  DT = 1 / HZ,
  HISTORY_TICKS = 300 * HZ;
export const RADIUS = 0.3,
  BODY_HEIGHT = 1.75,
  EYE_HEIGHT = 1.58;
export enum Block {
  Air,
  Grass,
  Dirt,
  Stone,
  Wood,
  Leaf,
  Path,
  Bedrock,
  Workbench,
  Lantern,
  Campfire,
  Planter,
  Feeder,
  Planks,
  Sand,
  Slate,
}
export type Kind = "player" | "echo" | "worker" | "animal" | "enemy";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Edit {
  x: number;
  y: number;
  z: number;
  block: Block;
  expected?: Block;
}
export interface Command {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  sprint: boolean;
  edit?: Edit;
  action?: Action;
  weapon?: number;
  attack?: boolean;
  guard?: boolean;
}
export enum WorkerTask {
  Patrol,
  Build,
  Dismantle,
  Fetch,
  Deliver,
  Inspect,
  Celebrate,
  Listen,
  Follow,
}
/** Immutable between combat changes, shared safely by historical frames. */
export interface CombatState {
  readonly health: number;
  readonly weapon: number;
  readonly readyAt: number;
  readonly hurtAt: number;
  readonly guarding: boolean;
}
export interface CombatEffect {
  kind: "slash" | "bolt" | "hit" | "guard" | "defeat";
  from: Vec3;
  to: Vec3;
  tick: number;
  actorId: number;
}
export interface Actor extends Vec3 {
  instinct?: NpcIntent;
  plan?: NpcIntent;
  combat?: CombatState;
  id: number;
  kind: Kind;
  vy: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  program: number;
  cursor: number;
  site: number;
  role: number;
  nextPlan: number;
  path: readonly number[];
  waypoint: number;
  moving: boolean;
  birth: number;
  task: WorkerTask;
  taskStep: number;
  taskUntil: number;
  cargo: number;
}
export interface Job {
  phase: number;
  index: number;
  waitUntil: number;
  cycle: number;
}
export interface Delta {
  index: number;
  before: Block;
  after: Block;
}
export interface RecordedCommand {
  actorId: number;
  command: Command;
}
export interface Replay {
  id: number;
  commands: readonly Command[];
}
export interface Snapshot {
  tick: number;
  playerId: number;
  rng: number;
  actors: Actor[];
  jobs: Job[];
  camp: CampState;
}
export interface Site {
  name: string;
  x: number;
  z: number;
  cells: Edit[];
  blueprints: { name: string; cells: Edit[] }[];
  supplies: readonly Vec3[];
  patrol: readonly Vec3[];
  stands: readonly Vec3[];
}
export const idle = (a: Pick<Actor, "yaw" | "pitch">): Command => ({
  mx: 0,
  mz: 0,
  yaw: a.yaw,
  pitch: a.pitch,
  jump: false,
  sprint: false,
});
export const copyActor = (a: Actor): Actor => ({ ...a, path: a.path });
export function actor(
  id: number,
  kind: Kind,
  x: number,
  y: number,
  z: number,
): Actor {
  return {
    id,
    kind,
    combat:
      kind === "player" || kind === "echo" || kind === "enemy"
        ? Object.freeze({
            health: kind === "enemy" ? 55 : 100,
            weapon: 0,
            readyAt: 0,
            hurtAt: -1000,
            guarding: false,
          })
        : undefined,
    x,
    y,
    z,
    vy: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    program: 0,
    cursor: 0,
    site: -1,
    role: 0,
    nextPlan: 0,
    path: [],
    waypoint: 0,
    moving: false,
    birth: 0,
    task: WorkerTask.Patrol,
    taskStep: 0,
    taskUntil: 0,
    cargo: 0,
  };
}
export function bodyRadius(a: Vec3 & { kind?: Kind; role?: number }): number {
  return a.kind === "animal"
    ? a.role === 0
      ? 0.2
      : 0.36
    : a.kind === "enemy" && a.role === 1
      ? 0.4
      : RADIUS;
}
export function bodyHeight(a: Vec3 & { kind?: Kind; role?: number }): number {
  return a.kind === "animal"
    ? a.role === 0
      ? 0.52
      : 1.3
    : a.kind === "enemy" && a.role === 1
      ? 2.05
      : BODY_HEIGHT;
}
export function overlap(a: Vec3, b: Vec3): boolean {
  const radius = bodyRadius(a) + bodyRadius(b);
  return (
    Math.abs(a.x - b.x) < radius - 0.001 &&
    Math.abs(a.z - b.z) < radius - 0.001 &&
    a.y < b.y + bodyHeight(b) - 0.001 &&
    a.y + bodyHeight(a) > b.y + 0.001
  );
}
export const cloneCommand = (c: Command): Command => ({
  ...c,
  edit: c.edit ? { ...c.edit } : undefined,
  action: c.action ? { ...c.action } : undefined,
});

export const alive = (a: Pick<Actor, "combat">): boolean =>
  !a.combat || a.combat.health > 0;
