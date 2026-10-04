import {
  actor,
  alive,
  Block,
  bodyHeight,
  bodyRadius,
  cloneCommand,
  copyActor,
  EYE_HEIGHT,
  idle,
  WIDTH,
  WorkerTask,
  type Actor,
  type Command,
  type CombatEffect,
  type Edit,
  type RecordedCommand,
  type Replay,
  type Snapshot,
} from "./model";
import { findPath, moveActor } from "./physics";
import { blueprintAt, createLandscape, raycast, SITES, Voxels } from "./world";
import {
  ActionType,
  initialCamp,
  FORAGE_SPOTS,
  MATERIALS,
  RECIPES,
  REQUESTS,
  recipeFor,
  animalName,
  type Action,
  type ForageNode,
} from "./camp";
import { ENEMIES, enemyCommand, resolveCombat } from "./combat";
import type { AIResponse } from "./ai-contract";
import { applyAIResponse, workerIntention } from "./intelligence";
import {
  MAX_EXCHANGES,
  MAX_SESSION_EXCHANGES,
  MAX_MESSAGE,
  MAX_REPLY,
  type ConversationBatch,
} from "./conversation-contract";
export class Simulation {
  // Epoch is transport-only: snapshots never restore a pending network request.
  epoch = 0;
  private queuedAI: AIResponse[] = [];
  private queuedConversation?: ConversationBatch;
  get hasQueuedConversation(): boolean {
    return this.queuedConversation !== undefined;
  }
  /** Dialogue completes while menus pause the world; commit it on the next tick. */
  queueConversation(batch: ConversationBatch): void {
    if (
      this.queuedConversation ||
      !batch ||
      batch.epoch !== this.epoch ||
      batch.tick !== this.tick ||
      batch.playerId !== this.playerId ||
      !Number.isInteger(batch.npcId) ||
      !Array.isArray(batch.turns) ||
      batch.turns.length < 1 ||
      batch.turns.length > MAX_SESSION_EXCHANGES ||
      !Array.from(batch.turns).every(
        (turn) =>
          turn &&
          typeof turn.player === "string" &&
          turn.player.trim().length > 0 &&
          turn.player.length <= MAX_MESSAGE &&
          typeof turn.npc === "string" &&
          turn.npc.trim().length > 0 &&
          turn.npc.length <= MAX_REPLY &&
          (turn.source === "openai" || turn.source === "local") &&
          turn.tick === batch.tick &&
          turn.playerId === batch.playerId,
      )
    )
      return;
    this.queuedConversation = Object.freeze({
      epoch: batch.epoch,
      tick: batch.tick,
      playerId: batch.playerId,
      npcId: batch.npcId,
      turns: Object.freeze(
        batch.turns.map((turn) =>
          Object.freeze({
            player: turn.player,
            npc: turn.npc,
            source: turn.source,
            tick: turn.tick,
            playerId: turn.playerId,
          }),
        ),
      ),
    });
  }
  private applyQueuedConversation(): void {
    const batch = this.queuedConversation;
    this.queuedConversation = undefined;
    if (
      !batch ||
      batch.epoch !== this.epoch ||
      batch.tick !== this.tick - 1 ||
      batch.playerId !== this.playerId ||
      !alive(this.player)
    )
      return;
    const npc = this.actors.find((a) => a.id === batch.npcId);
    if (
      !npc ||
      npc.kind !== "worker" ||
      !alive(npc) ||
      !this.canReach(this.player, { ...npc, y: npc.y + bodyHeight(npc) * 0.65 })
    )
      return;
    const turns = batch.turns.map((turn) =>
      Object.freeze({
        ...turn,
        tick: this.tick,
      }),
    );
    const memory = Object.freeze(
      [...(this.camp.conversations[npc.id] ?? []), ...turns].slice(
        -MAX_EXCHANGES,
      ),
    );
    this.camp = {
      ...this.camp,
      conversations: Object.freeze({
        ...this.camp.conversations,
        [npc.id]: memory,
      }),
    };
  }
  queueAI(response: AIResponse): void {
    if (response.epoch === this.epoch && this.queuedAI.length < 2)
      this.queuedAI.push(response);
  }
  clearQueuedAI(): void {
    this.queuedAI = [];
  }
  voxels: Voxels;
  tick = 0;
  playerId = 1;
  rng = 1234567;
  nextId = 13;
  camp = initialCamp();
  forage: ForageNode[];
  feedback: string[] = [];
  effects: CombatEffect[] = [];
  nextProgram = 1;
  actors: Actor[];
  jobs = SITES.map(() => ({ phase: 0, index: 0, waitUntil: 0, cycle: 0 }));
  replays = new Map<number, Replay>();
  constructor(voxels = createLandscape()) {
    this.voxels = voxels;
    this.forage = FORAGE_SPOTS.map(([x, z, kind], id) => ({
      id,
      kind,
      x: x + 0.5,
      z: z + 0.5,
      y: voxels.ground(x, z),
    }));
    this.actors = [actor(1, "player", 31.5, voxels.ground(31, 39), 39.5)];
    this.player.yaw = 0.35;
    SITES.forEach((s, i) =>
      s.stands.forEach((p, role) => {
        const a = actor(2 + i * 2 + role, "worker", p.x, p.y, p.z);
        a.site = i;
        a.role = role;
        a.yaw = role === 0 ? -Math.PI / 2 : Math.PI / 2;
        this.actors.push(a);
      }),
    );
    [
      [25.5, 44.5],
      [20.5, 47.5],
      [44.5, 48.5],
      [49.5, 43.5],
    ].forEach(([x, z], i) => {
      const a = actor(6 + i, "animal", x, voxels.ground(x, z), z);
      a.site = i;
      a.role = i < 2 ? 0 : 1;
      a.taskUntil = 120 + i * 60;
      this.actors.push(a);
    });
    ENEMIES.forEach((spec, role) => {
      const a = actor(
        10 + role,
        "enemy",
        spec.x,
        voxels.ground(spec.x, spec.z),
        spec.z,
      );
      a.role = role;
      a.yaw = Math.PI;
      a.combat = Object.freeze({
        health: spec.health,
        weapon: role === 2 ? 2 : 1,
        readyAt: 0,
        hurtAt: -1000,
        guarding: false,
      });
      this.actors.push(a);
    });
  }
  get player(): Actor {
    const p = this.actors.find((a) => a.id === this.playerId);
    if (!p) throw Error("Missing controlled player");
    return p;
  }
  random(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      playerId: this.playerId,
      rng: this.rng,
      actors: this.actors.map(copyActor),
      jobs: this.jobs.map((j) => ({ ...j })),
      camp: this.camp,
    };
  }
  restore(s: Snapshot): void {
    this.epoch++;
    this.clearQueuedAI();
    this.queuedConversation = undefined;
    this.tick = s.tick;
    this.playerId = s.playerId;
    this.rng = s.rng;
    this.actors = s.actors.map(copyActor);
    this.jobs = s.jobs.map((j) => ({ ...j }));
    this.camp = s.camp;
    this.feedback = [];
    this.effects = [];
    this.voxels.pending = [];
  }
  edit(a: Actor, e: Edit): boolean {
    if (!alive(a)) return false;
    if (
      !Number.isInteger(e.x) ||
      !Number.isInteger(e.y) ||
      !Number.isInteger(e.z) ||
      !this.voxels.inside(e.x, e.y, e.z)
    )
      return false;
    const old = this.voxels.get(e.x, e.y, e.z);
    if (old === Block.Bedrock || e.block === Block.Bedrock || e.y === 0)
      return false;
    if (e.expected !== undefined && old !== e.expected) return false;
    const distance = Math.hypot(
      e.x + 0.5 - a.x,
      e.y + 0.5 - a.y - EYE_HEIGHT,
      e.z + 0.5 - a.z,
    );
    if (distance > 5.5) return false;
    const sight = raycast(
      this.voxels,
      { x: a.x, y: a.y + EYE_HEIGHT, z: a.z },
      {
        x: (e.x + 0.5 - a.x) / distance,
        y: (e.y + 0.5 - a.y - EYE_HEIGHT) / distance,
        z: (e.z + 0.5 - a.z) / distance,
      },
      distance,
    );
    if (
      a.kind !== "worker" &&
      sight &&
      (sight.x !== e.x || sight.y !== e.y || sight.z !== e.z)
    )
      return false;
    if (e.block !== Block.Air) {
      if (old !== Block.Air) return false;
      if (
        this.actors.some(
          (b) =>
            alive(b) &&
            b.x + bodyRadius(b) > e.x &&
            b.x - bodyRadius(b) < e.x + 1 &&
            b.z + bodyRadius(b) > e.z &&
            b.z - bodyRadius(b) < e.z + 1 &&
            b.y + bodyHeight(b) > e.y &&
            b.y < e.y + 1,
        )
      )
        return false;
    } else if (old === Block.Air) return false;
    const recipe = recipeFor(e.block),
      reclaimed = recipeFor(old);
    if (recipe && (a.kind === "worker" || this.camp.bag[recipe.slot] < 1)) {
      this.say(a, "Craft this item first. Press B to open your field kit.");
      return false;
    }
    const changed = this.voxels.set(e.x, e.y, e.z, e.block);
    if (changed && a.kind !== "worker") {
      const bag = [...this.camp.bag];
      if (recipe) bag[recipe.slot]--;
      if (reclaimed) bag[reclaimed.slot]++;
      if (e.block === Block.Air && !reclaimed) {
        if (old === Block.Wood) bag[0]++;
        if (old === Block.Stone || old === Block.Slate) bag[1]++;
      }
      const index = Voxels.index(e.x, e.y, e.z);
      const feeders = this.camp.feeders.filter((f) => f.index !== index);
      if (e.block === Block.Feeder)
        feeders.push({ index, until: this.tick + 3600 });
      this.camp = { ...this.camp, bag, feeders };
    } else if (changed && old === Block.Feeder) {
      const index = Voxels.index(e.x, e.y, e.z);
      this.camp = {
        ...this.camp,
        feeders: this.camp.feeders.filter((f) => f.index !== index),
      };
    }
    return changed;
  }
  private say(a: Actor, message: string): void {
    if (a.id === this.playerId) this.feedback.push(message);
  }
  /** Reach and visibility are rechecked when a recorded interaction is replayed. */
  canReach(
    a: Actor,
    p: { x: number; y: number; z: number },
    range = 3.2,
    targetBlock = false,
  ): boolean {
    const origin = { x: a.x, y: a.y + EYE_HEIGHT, z: a.z };
    const dx = p.x - origin.x,
      dy = p.y - origin.y,
      dz = p.z - origin.z,
      d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    const hit =
      d < 0.01
        ? undefined
        : raycast(
            this.voxels,
            origin,
            { x: dx / d, y: dy / d, z: dz / d },
            Math.max(0, d - 0.12),
          );
    return (
      !hit ||
      (targetBlock &&
        hit.x === Math.floor(p.x) &&
        hit.y === Math.floor(p.y) &&
        hit.z === Math.floor(p.z))
    );
  }
  forageReady(n: ForageNode): boolean {
    return (
      (this.camp.harvested[n.id] ?? 0) <= this.tick &&
      !!this.voxels.get(Math.floor(n.x), n.y - 1, Math.floor(n.z)) &&
      !this.voxels.get(Math.floor(n.x), n.y, Math.floor(n.z))
    );
  }
  interact(a: Actor, action: Action): boolean {
    if (a.kind !== "player" && a.kind !== "echo") return false;
    const fail = (message: string) => {
      this.say(a, message);
      return false;
    };
    const bag = [...this.camp.bag],
      requests = [...this.camp.requests];
    if (action.type === ActionType.Gather) {
      const n = this.forage[action.target];
      if (
        !n ||
        !this.forageReady(n) ||
        !this.canReach(a, { ...n, y: n.y + 0.35 })
      )
        return fail("Move closer to a fresh foraging patch.");
      bag[n.kind] += 2;
      this.camp = {
        ...this.camp,
        bag,
        harvested: { ...this.camp.harvested, [n.id]: this.tick + 1800 },
      };
      this.say(
        a,
        `Gathered 2 ${MATERIALS[n.kind].toLowerCase()}. It regrows in 30 world seconds.`,
      );
      return true;
    }
    if (action.type === ActionType.Craft) {
      const r = RECIPES[action.target];
      if (!r || r.cost.some((n, i) => bag[i] < n))
        return fail("Gather a few more supplies for this recipe.");
      r.cost.forEach((n, i) => (bag[i] -= n));
      bag[r.slot]++;
      this.camp = { ...this.camp, bag };
      this.say(a, `${r.name} crafted. Select 5 and right click to place it.`);
      return true;
    }
    if (action.type === ActionType.Refill) {
      const p = Voxels.position(action.target);
      if (
        this.voxels.get(p.x, p.y, p.z) !== Block.Feeder ||
        !this.canReach(
          a,
          { x: p.x + 0.5, y: p.y + 0.7, z: p.z + 0.5 },
          3.2,
          true,
        ) ||
        bag[3] < 2
      )
        return fail("A refill needs 2 berries. Move beside the feeder.");
      bag[3] -= 2;
      this.camp = {
        ...this.camp,
        bag,
        feeders: [
          ...this.camp.feeders.filter((f) => f.index !== action.target),
          { index: action.target, until: this.tick + 3600 },
        ],
      };
      this.say(a, "Feeder refilled for one minute of world time.");
      return true;
    }
    const target = this.actors.find((b) => b.id === action.target);
    if (
      !target ||
      !this.canReach(a, {
        x: target.x,
        y: target.y + bodyHeight(target) * 0.65,
        z: target.z,
      })
    )
      return fail("They’ve moved away. Step closer and try again.");
    if (target.kind === "worker") {
      const index = target.id - 2,
        request = REQUESTS[index];
      if (action.type === ActionType.Order) {
        const mode = action.value ?? 0;
        if (mode < 0 || mode > 2) return false;
        this.camp = {
          ...this.camp,
          orders: this.camp.orders.map((o, i) =>
            i === index
              ? {
                  mode,
                  owner: a.id,
                  until: this.tick + (mode === 1 ? 1200 : 1800),
                }
              : o,
          ),
        };
        this.setTask(
          target,
          mode === 1
            ? WorkerTask.Listen
            : mode === 2
              ? WorkerTask.Follow
              : WorkerTask.Patrol,
        );
        this.say(
          a,
          mode === 1
            ? "I’ll wait here for twenty seconds."
            : mode === 2
              ? "Lead the way. I’ll follow for thirty seconds."
              : "Back to work. Give me a shout if you need me.",
        );
        return true;
      }
      if (action.type === ActionType.Accept && !requests[index]) {
        requests[index] = 1;
        this.camp = { ...this.camp, requests };
        this.say(a, "Request added to your journal. Press J to read it.");
        return true;
      }
      if (action.type === ActionType.Deliver && requests[index] === 1) {
        if (
          request.need.some((n, i) => bag[i] < n) ||
          (index === 3 &&
            !this.actors.some((b) => b.kind === "animal" && b.cargo >= 2))
        )
          return fail(request.detail);
        request.need.forEach((n, i) => (bag[i] -= n));
        bag[request.reward] += request.quantity;
        requests[index] = 2;
        this.camp = { ...this.camp, bag, requests };
        this.say(a, request.thanks);
        return true;
      }
    }
    if (
      target.kind === "animal" &&
      (action.type === ActionType.Feed || action.type === ActionType.Pet)
    ) {
      if (action.type === ActionType.Feed) {
        if (bag[3] < 1)
          return fail("Find a berry bush first. Feeding costs one berry.");
        if (target.cursor > this.tick)
          return fail("Let them finish their snack first.");
        bag[3]--;
        target.cargo = Math.min(3, target.cargo + 1);
        target.program = a.id;
        target.task = 4;
        target.taskUntil = this.tick + 150;
        target.cursor = this.tick + 150;
        target.path = [];
        target.waypoint = 0;
        target.nextPlan = 0;
        this.camp = { ...this.camp, bag };
        this.say(
          a,
          `${animalName(target)} trusts you a little more. Walk slowly and they’ll follow.`,
        );
        return true;
      }
      if (!target.cargo) return fail("They’re still shy. Offer a berry first.");
      target.task = 4;
      target.taskUntil = this.tick + 90;
      target.program = a.id;
      this.say(a, `${animalName(target)} settles beside you.`);
      return true;
    }
    return false;
  }
  private animalCommand(a: Actor, playerCommand: Command): Command {
    const c = idle(a);
    const people = this.actors.filter(
      (b) => b.kind === "player" || b.kind === "echo",
    );
    const near = people.find(
      (b) =>
        Math.hypot(b.x - a.x, b.z - a.z) < 3 &&
        b.moving &&
        b.id === this.playerId &&
        playerCommand.sprint,
    );
    if (near && a.cargo < 2 && a.task !== 3) {
      a.task = 3;
      a.taskUntil = this.tick + 150;
      a.path = [];
      a.nextPlan = 0;
      a.waypoint = 0;
      const dx = a.x - near.x,
        dz = a.z - near.z,
        d = Math.hypot(dx, dz) || 1;
      // The retained path stores the flee destination as well as progress.
      const gx = Math.max(2, Math.min(61, a.x + (dx / d) * 5)),
        gz = Math.max(2, Math.min(61, a.z + (dz / d) * 5));
      this.walkTo(a, gx, gz, c);
      return c;
    }
    if (a.task === 4 && this.tick < a.taskUntil) return c;
    if (a.task === 4) {
      a.task = a.program ? 2 : 0;
      a.taskUntil = this.tick + 1200;
    }
    const owner = this.actors.find((b) => b.id === a.program);
    if (a.task === 2 && owner && this.tick < a.taskUntil) {
      const d = Math.hypot(a.x - owner.x, a.z - owner.z);
      if (d > 1.6 && d < 16) {
        const dx = (a.x - owner.x) / d,
          dz = (a.z - owner.z) / d;
        return this.walkTo(a, owner.x + dx * 1.3, owner.z + dz * 1.3, c);
      }
      c.yaw = Math.atan2(-(owner.x - a.x), -(owner.z - a.z));
      return c;
    }
    const feeder = this.camp.feeders.find(
      (f) =>
        f.until > this.tick &&
        (() => {
          const p = Voxels.position(f.index);
          return Math.hypot(p.x - a.x, p.z - a.z) < 9;
        })(),
    );
    if (feeder && a.task !== 3) {
      const p = Voxels.position(feeder.index),
        d = Math.hypot(p.x + 0.5 - a.x, p.z + 0.5 - a.z);
      if (d > 1.4)
        return this.walkTo(
          a,
          p.x + 0.5 + (a.x > p.x ? 1.4 : -1.4),
          p.z + 0.5,
          c,
        );
      c.yaw = Math.atan2(-(p.x + 0.5 - a.x), -(p.z + 0.5 - a.z));
      return c;
    }
    if (
      a.path.length &&
      a.waypoint < a.path.length &&
      this.tick < a.taskUntil
    ) {
      const goal = a.path[a.path.length - 1];
      this.walkTo(a, (goal % WIDTH) + 0.5, Math.floor(goal / WIDTH) + 0.5, c);
      if (a.task === 3) {
        c.mx *= 1.6;
        c.mz *= 1.6;
      }
      return c;
    }
    if (a.task !== 0) {
      a.task = 0;
      a.taskUntil = this.tick + 120 + Math.floor(this.random() * 180);
      a.path = [];
      a.waypoint = 0;
    }
    if (this.tick < a.taskUntil) return c;
    const homes = [
        [25.5, 44.5],
        [20.5, 47.5],
        [44.5, 48.5],
        [49.5, 43.5],
      ],
      home = homes[a.site];
    const gx = Math.max(3, Math.min(60, home[0] + (this.random() - 0.5) * 12)),
      gz = Math.max(40.5, Math.min(59, home[1] + (this.random() - 0.5) * 12));
    a.task = 1;
    a.taskUntil = this.tick + 420;
    a.nextPlan = 0;
    return this.walkTo(a, gx, gz, c);
  }
  private setTask(a: Actor, task: WorkerTask): void {
    if (a.task === task) return;
    a.task = task;
    a.taskStep = 0;
    a.taskUntil = 0;
    a.nextPlan = 0;
    a.path = [];
    a.waypoint = 0;
  }
  private station(a: Actor, task: WorkerTask, c: Command): Command {
    this.setTask(a, task);
    const depot = SITES[a.site].supplies[a.role];
    if (Math.hypot(depot.x - a.x, depot.z - a.z) > 0.3)
      return this.walkTo(a, depot.x, depot.z, c);
    if (!a.taskUntil) a.taskUntil = this.tick + 50;
    c.yaw = Math.PI;
    if (this.tick >= a.taskUntil) {
      a.cargo = task === WorkerTask.Fetch ? 3 : 0;
      this.setTask(a, a.role === 0 ? WorkerTask.Build : WorkerTask.Dismantle);
    }
    return c;
  }
  private workerCommand(a: Actor): Command {
    const site = SITES[a.site],
      job = this.jobs[a.site],
      c = idle(a),
      blueprint = blueprintAt(a.site, job.cycle);
    const order = this.camp.orders[a.id - 2];
    if (order?.mode && this.tick < order.until) {
      const owner = this.actors.find((b) => b.id === order.owner);
      this.setTask(a, order.mode === 1 ? WorkerTask.Listen : WorkerTask.Follow);
      if (owner) {
        const d = Math.hypot(owner.x - a.x, owner.z - a.z);
        c.yaw = Math.atan2(-(owner.x - a.x), -(owner.z - a.z));
        if (order.mode === 2 && d > 2 && d < 25)
          return this.walkTo(
            a,
            owner.x + ((a.x - owner.x) / d) * 1.6,
            owner.z + ((a.z - owner.z) / d) * 1.6,
            c,
          );
      }
      return c;
    }
    const intention = workerIntention(this, a, (actor, x, z, c) =>
      this.walkTo(actor, x, z, c),
    );
    if (intention) return intention;
    if (job.phase !== a.role) {
      this.setTask(a, WorkerTask.Patrol);
      const point =
        site.patrol[(a.taskStep + a.role + a.site) % site.patrol.length];
      if (Math.hypot(point.x - a.x, point.z - a.z) > 0.3)
        return this.walkTo(a, point.x, point.z, c);
      if (!a.taskUntil) a.taskUntil = this.tick + 75;
      c.yaw = Math.atan2(-(site.x + 0.5 - a.x), -(site.z + 0.5 - a.z));
      if (this.tick >= a.taskUntil) {
        a.taskStep = (a.taskStep + 1) % site.patrol.length;
        a.taskUntil = 0;
        a.nextPlan = 0;
      }
      return c;
    }
    if (
      a.role === 1 &&
      (a.cargo >= 3 ||
        a.task === WorkerTask.Deliver ||
        (job.index >= blueprint.cells.length && a.cargo > 0))
    )
      return this.station(a, WorkerTask.Deliver, c);
    if (job.index >= blueprint.cells.length) {
      if (a.task === WorkerTask.Celebrate) {
        // The completed structure remains for an inspection and a short celebration.
        if (this.tick >= a.taskUntil) {
          job.index = 0;
          job.phase = 1 - job.phase;
          job.cycle++;
          job.waitUntil = this.tick + 60;
          a.cargo = 0;
          this.setTask(a, WorkerTask.Patrol);
        }
        return c;
      }
      this.setTask(a, WorkerTask.Inspect);
      const point = site.patrol[a.taskStep === 0 ? 0 : 2];
      if (Math.hypot(point.x - a.x, point.z - a.z) > 0.3)
        return this.walkTo(a, point.x, point.z, c);
      if (!a.taskUntil) a.taskUntil = this.tick + 45;
      c.yaw = Math.atan2(-(site.x + 0.5 - a.x), -(site.z + 0.5 - a.z));
      if (this.tick >= a.taskUntil) {
        a.taskStep++;
        a.taskUntil = 0;
        a.nextPlan = 0;
        if (a.taskStep >= 2) {
          this.setTask(a, WorkerTask.Celebrate);
          a.taskUntil = this.tick + 90;
        }
      }
      return c;
    }
    if (a.role === 0 && (a.cargo === 0 || a.task === WorkerTask.Fetch))
      return this.station(a, WorkerTask.Fetch, c);
    this.setTask(a, a.role === 0 ? WorkerTask.Build : WorkerTask.Dismantle);
    const cell =
      blueprint.cells[
        a.role === 0 ? job.index : blueprint.cells.length - 1 - job.index
      ];
    const gx = cell.x + (a.role === 0 ? -1.5 : 2.5),
      gz = cell.z + 1.5;
    this.walkTo(a, gx, gz, c);
    c.yaw = Math.atan2(-(cell.x + 0.5 - a.x), -(cell.z + 0.5 - a.z));
    if (Math.hypot(gx - a.x, gz - a.z) > 0.65 || this.tick < job.waitUntil)
      return c;
    const desired = a.role === 0 ? cell.block : Block.Air,
      current = this.voxels.get(cell.x, cell.y, cell.z);
    if (current === desired || this.edit(a, { ...cell, block: desired })) {
      if (current !== desired) a.cargo += a.role === 0 ? -1 : 1;
      job.index++;
      job.waitUntil = this.tick + 35 + Math.floor(this.random() * 15);
      a.taskUntil = this.tick + 24;
      a.nextPlan = 0;
    } else {
      job.waitUntil = this.tick + 30;
      a.nextPlan = 0;
    }
    return c;
  }
  private walkTo(a: Actor, gx: number, gz: number, c: Command): Command {
    if (Math.hypot(a.x - gx, a.z - gz) < 0.25) {
      if (a.path.length) a.path = [];
      a.waypoint = 0;
      return c;
    }
    if (
      this.tick >= a.nextPlan ||
      (a.path.length > 0 && a.waypoint >= a.path.length)
    ) {
      const occupied = new Set(
        this.actors
          .filter((b) => b.id !== a.id && alive(b))
          .map((b) => Math.floor(b.x) + Math.floor(b.z) * WIDTH),
      );
      // A pursued actor occupies the goal; physics still prevents body overlap.
      occupied.delete(Math.floor(gx) + Math.floor(gz) * WIDTH);
      a.path = findPath(this.voxels, a, { x: gx, y: 5, z: gz }, occupied);
      a.waypoint = 0;
      a.nextPlan = this.tick + 60;
    }
    const node = a.path[a.waypoint];
    if (node === undefined) return c;
    const last = a.waypoint === a.path.length - 1;
    const tx = last ? gx : (node % WIDTH) + 0.5,
      tz = last ? gz : Math.floor(node / WIDTH) + 0.5;
    const dx = tx - a.x,
      dz = tz - a.z,
      dist = Math.hypot(dx, dz);
    if (dist < 0.16) {
      a.waypoint++;
      return c;
    }
    c.mx = (dx / dist) * 0.56;
    c.mz = (dz / dist) * 0.56;
    c.yaw = Math.atan2(-dx, -dz);
    return c;
  }
  step(playerCommand: Command): RecordedCommand[] {
    this.tick++;
    this.applyQueuedConversation();
    for (const response of this.queuedAI) applyAIResponse(this, response);
    this.clearQueuedAI();
    this.feedback = [];
    // Keep brief cues across multiple fixed steps in a single rendered frame.
    this.effects = this.effects.filter(
      (effect) => effect.tick > this.tick - 10,
    );
    this.voxels.pending = [];
    const recorded: RecordedCommand[] = [];
    const ordered = [
      this.player,
      ...this.actors
        .filter((a) => a.kind === "echo")
        .sort((a, b) => a.id - b.id),
      ...this.actors
        .filter((a) => a.kind === "worker")
        .sort((a, b) => a.id - b.id),
      ...this.actors
        .filter((a) => a.kind === "animal")
        .sort((a, b) => a.id - b.id),
      ...this.actors
        .filter((a) => a.kind === "enemy")
        .sort((a, b) => a.id - b.id),
    ];
    for (const a of ordered) {
      let command: Command;
      if (a.kind === "player") command = playerCommand;
      else if (a.kind === "echo") {
        const replay = this.replays.get(a.program);
        command = replay?.commands[a.cursor] ?? idle(a);
        if (replay && a.cursor < replay.commands.length) a.cursor++;
      } else
        command =
          a.kind === "enemy"
            ? enemyCommand(this, a, (actor, x, z, c) =>
                this.walkTo(actor, x, z, c),
              )
            : a.kind === "animal"
              ? this.animalCommand(a, playerCommand)
              : this.workerCommand(a);
      if (!alive(a)) command = idle(a);
      if (a.kind === "player" || a.kind === "echo")
        recorded.push({ actorId: a.id, command: cloneCommand(command) });
      if (!alive(a)) {
        a.moving = false;
        continue;
      }
      moveActor(this.voxels, a, command, this.actors);
      resolveCombat(this, a, command);
      if (!a.combat?.weapon) {
        if (command.edit) this.edit(a, command.edit);
      }
      if (command.action) this.interact(a, command.action);
    }
    return recorded;
  }
  createReplay(commands: Command[]): Replay {
    const replay = Object.freeze({
      id: this.nextProgram++,
      commands: Object.freeze(
        commands.map((c) => {
          const command = cloneCommand(c);
          if (command.edit) Object.freeze(command.edit);
          if (command.action) Object.freeze(command.action);
          return Object.freeze(command);
        }),
      ),
    });
    this.replays.set(replay.id, replay);
    return replay;
  }
}
