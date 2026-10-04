import { describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { actor, Block, idle, type Actor, type Command } from "../src/model";
import { advance, History } from "../src/history";
import { blocked } from "../src/physics";
import { Simulation } from "../src/simulation";
import { Temporal } from "../src/temporal";
import { Voxels } from "../src/world";

function fixture(enemyZ = 8.5) {
  const voxels = new Voxels();
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) voxels.set(x, 0, z, Block.Bedrock, false);
  voxels.pending = [];
  const sim = new Simulation(voxels);
  sim.actors = [actor(1, "player", 10.5, 1, 10.5)];
  sim.nextId = 20;
  const enemy = actor(10, "enemy", 10.5, 1, enemyZ);
  quiet(enemy);
  sim.actors.push(enemy);
  const history = new History(sim);
  return { sim, history, temporal: new Temporal(sim, history), enemy };
}

// A long telegraph keeps the target stationary without bypassing combat itself.
function quiet(enemy: Actor) {
  enemy.task = 2;
  enemy.taskUntil = 100000;
  enemy.cursor = 1;
  enemy.combat = { ...enemy.combat!, readyAt: 100000 };
}
function attack(sim: Simulation, weapon: 1 | 2 = 2): Command {
  return { ...idle(sim.player), weapon, attack: true };
}
function wall(sim: Simulation, z: number) {
  for (let y = 1; y <= 3; y++) sim.voxels.set(10, y, z, Block.Stone);
}
function health(sim: Simulation, id: number) {
  return sim.actors.find((a) => a.id === id)!.combat!.health;
}
function branch(temporal: Temporal, tick: number) {
  temporal.enter();
  temporal.seek(tick);
  temporal.traveller.x = 14.5;
  temporal.traveller.z = 10.5;
  temporal.traveller.y = 1;
  return temporal.resume();
}

describe("weapons resolve against the current world", () => {
  it("gives the sword short reach and the crossbow a longer, finite reach", () => {
    const close = fixture();
    advance(close.sim, close.history, attack(close.sim, 1));
    expect(close.enemy.combat!.health).toBe(55 - 32);
    const distant = fixture(5.5);
    advance(distant.sim, distant.history, attack(distant.sim, 1));
    expect(distant.enemy.combat!.health).toBe(55);
    const ranged = fixture(5.5);
    advance(ranged.sim, ranged.history, attack(ranged.sim, 2));
    expect(ranged.enemy.combat!.health).toBe(55 - 24);
    const beyond = fixture(1.5);
    beyond.sim.player.z = 35.5;
    advance(beyond.sim, beyond.history, attack(beyond.sim, 2));
    expect(beyond.enemy.combat!.health).toBe(55);
  });

  it.each([1, 2] as const)(
    "blocks weapon %i attacks with solid terrain",
    (weapon) => {
      const { sim, history, enemy } = fixture();
      wall(sim, 9);
      history.record([], true);
      advance(sim, history, attack(sim, weapon));
      expect(enemy.combat!.health).toBe(55);
    },
  );

  it("hits the first enemy in the shot instead of damaging everyone behind it", () => {
    const { sim, history, enemy } = fixture(7.5);
    const back = actor(11, "enemy", 10.5, 1, 5.5);
    quiet(back);
    sim.actors.push(back);
    advance(sim, history, attack(sim));
    expect(enemy.combat!.health).toBe(31);
    expect(back.combat!.health).toBe(55);
  });

  it("lets a past self intercept a shot while protecting it from friendly damage", () => {
    const { sim, history, enemy } = fixture(5.5);
    const echo = actor(21, "echo", 10.5, 1, 8.5);
    sim.actors.push(echo);
    advance(sim, history, attack(sim));
    expect(echo.combat!.health).toBe(100);
    expect(enemy.combat!.health).toBe(55);
  });

  it("leaves workers and animals unharmed by player weapon attempts", () => {
    for (const kind of ["worker", "animal"] as const) {
      const { sim, history } = fixture(4.5);
      sim.actors = [sim.player];
      const friendly = actor(kind === "worker" ? 2 : 6, kind, 10.5, 1, 8.5);
      friendly.site = 0;
      friendly.taskUntil = 100000;
      sim.actors.push(friendly);
      advance(sim, history, attack(sim));
      expect(friendly.combat).toBeUndefined();
      expect(sim.actors.some((a) => a.id === friendly.id)).toBe(true);
    }
  });

  it("enforces attack recovery even when switching weapons", () => {
    const { sim, history, enemy } = fixture();
    advance(sim, history, attack(sim, 1));
    const afterSwing = enemy.combat!.health;
    advance(sim, history, attack(sim, 2));
    expect(enemy.combat!.health).toBe(afterSwing);
    while (sim.tick < sim.player.combat!.readyAt) advance(sim, history);
    advance(sim, history, attack(sim, 2));
    expect(enemy.combat!.health).toBe(0);
  });

  it("reduces a telegraphed melee hit with a sword guard only while facing the attacker", () => {
    function takeHit(guard: boolean, yaw: number) {
      const { sim, history, enemy } = fixture();
      enemy.taskUntil = 1;
      enemy.yaw = Math.PI;
      enemy.combat = { ...enemy.combat!, readyAt: 0 };
      advance(sim, history, { ...idle(sim.player), weapon: 1, guard, yaw });
      return 100 - sim.player.combat!.health;
    }
    const exposed = takeHit(false, 0);
    const facing = takeHit(true, 0);
    const turnedAway = takeHit(true, Math.PI);
    expect(exposed).toBeGreaterThan(0);
    expect(facing).toBeLessThan(exposed);
    expect(turnedAway).toBe(exposed);
  });

  it("makes a Warden's front shield strong but exposes its back and attack wind-up", () => {
    function swordHit(task: 0 | 2, yaw: number) {
      const { sim, history, enemy } = fixture();
      enemy.role = 1;
      enemy.task = task;
      enemy.yaw = yaw;
      enemy.combat = { ...enemy.combat!, health: 110 };
      advance(sim, history, attack(sim, 1));
      return 110 - enemy.combat!.health;
    }
    const shield = swordHit(0, Math.PI);
    expect(shield).toBeGreaterThan(0);
    expect(shield).toBeLessThan(swordHit(0, 0));
    expect(swordHit(2, Math.PI)).toBe(32);
  });

  it("makes the Raider pursue a visible player beyond melee reach", () => {
    const { sim, history, enemy } = fixture();
    sim.player.x = enemy.x = 35.5;
    sim.player.z = 21.5;
    enemy.z = 16.5;
    enemy.task = 0;
    enemy.taskUntil = 0;
    enemy.combat = { ...enemy.combat!, readyAt: 0 };
    for (let i = 0; i < 30; i++) advance(sim, history);
    expect(enemy.z).toBeGreaterThan(17.5);
    expect(enemy.z).toBeLessThan(sim.player.z - 0.5);
  });

  it("makes the Hunter retreat from a close player before readying another shot", () => {
    const { sim, history, enemy } = fixture();
    sim.player.x = enemy.x = 49.5;
    sim.player.z = 22.5;
    enemy.z = 19.5;
    enemy.role = 2;
    enemy.task = 0;
    enemy.taskUntil = 0;
    enemy.combat = { ...enemy.combat!, health: 70, readyAt: 0 };
    for (let i = 0; i < 10; i++) advance(sim, history);
    expect(enemy.z).toBeLessThan(19.3);
    expect(sim.player.combat!.health).toBe(100);
  });

  it("makes defeated enemies non-solid and unable to intercept later attacks", () => {
    const { sim, history, enemy } = fixture();
    enemy.combat = { ...enemy.combat!, health: 0 };
    const back = actor(11, "enemy", 10.5, 1, 5.5);
    quiet(back);
    sim.actors.push(back);
    expect(blocked(sim.voxels, enemy, sim.actors, sim.playerId)).toBe(false);
    advance(sim, history, attack(sim));
    expect(back.combat!.health).toBe(31);
    expect(enemy.combat!.health).toBe(0);
  });
});

describe("combat belongs to simulation time", () => {
  it("restores enemy defeats, weapon recovery, health and AI state in both preview directions", () => {
    const { sim, history, temporal, enemy } = fixture();
    enemy.combat = { ...enemy.combat!, health: 24 };
    history.record([], true);
    const before = sim.snapshot();
    advance(sim, history, attack(sim));
    expect(enemy.combat!.health).toBe(0);
    const defeated = sim.snapshot();
    temporal.enter();
    temporal.seek(0);
    expect(sim.snapshot()).toEqual(before);
    expect(health(sim, enemy.id)).toBe(24);
    temporal.seek(1);
    expect(sim.snapshot()).toEqual(defeated);
    temporal.seek(0);
    temporal.cancel();
    expect(sim.snapshot()).toEqual(defeated);
  });

  it("restores an enemy attack telegraph and reproduces the same later fight", () => {
    const { sim, history, enemy } = fixture();
    sim.player.x = enemy.x = 35.5;
    sim.player.z = 18.5;
    enemy.z = 16.5;
    enemy.task = 0;
    enemy.taskUntil = 0;
    enemy.combat = { ...enemy.combat!, readyAt: 0 };
    for (let i = 0; i < 120 && Number(enemy.task) !== 2; i++)
      advance(sim, history);
    expect(enemy.task).toBe(2);
    expect(enemy.taskUntil).toBeGreaterThan(sim.tick);
    const start = sim.snapshot();
    for (let i = 0; i < 100; i++) advance(sim, history);
    const result = sim.snapshot();
    expect(sim.player.combat!.health).toBeLessThan(100);
    history.seek(start.tick);
    expect(sim.snapshot()).toEqual(start);
    for (let i = 0; i < 100; i++) sim.step(idle(sim.player));
    expect(sim.snapshot()).toEqual(result);
  });

  it("lets a sidestep during the visible enemy wind-up change a hit into a miss", () => {
    const { sim, history, enemy } = fixture();
    sim.player.x = enemy.x = 35.5;
    sim.player.z = 18.5;
    enemy.z = 16.5;
    enemy.task = 0;
    enemy.taskUntil = 0;
    enemy.combat = { ...enemy.combat!, readyAt: 0 };
    advance(sim, history);
    expect(enemy.task).toBe(2);
    const telegraph = sim.snapshot();
    const strikeTick = enemy.taskUntil;
    while (sim.tick <= strikeTick) advance(sim, history);
    expect(sim.player.combat!.health).toBeLessThan(100);
    history.seek(telegraph.tick);
    while (sim.tick <= strikeTick) sim.step({ ...idle(sim.player), mx: 1 });
    expect(sim.player.combat!.health).toBe(100);
  });

  it("freezes combat while the temporal traveller moves and ignores attack attempts outside time", () => {
    const { sim, history, temporal } = fixture();
    advance(sim, history, attack(sim));
    temporal.enter();
    const before = sim.snapshot();
    const startX = temporal.view.x;
    for (let i = 0; i < 60; i++)
      temporal.update({
        ...idle(temporal.view),
        mx: 1,
        attack: true,
        weapon: 2,
        guard: true,
      });
    expect(temporal.view.x).toBeGreaterThan(startX + 3);
    expect(sim.snapshot()).toEqual(before);
    expect(history.latest).toBe(1);
  });

  it("records attack, guard and weapon selection immutably for the correct incarnation", () => {
    const { sim, history, temporal } = fixture(5.5);
    const command: Command = { ...attack(sim), guard: true };
    advance(sim, history, command);
    command.attack = false;
    command.guard = false;
    command.weapon = 1;
    expect(history.script(1, 0, 1)[0]).toMatchObject({
      attack: true,
      guard: true,
      weapon: 2,
    });
    expect(branch(temporal, 0).ok).toBe(true);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    const script = sim.replays.get(echo.program)!;
    expect(script.commands[0]).toMatchObject({
      attack: true,
      guard: true,
      weapon: 2,
    });
    expect(Object.isFrozen(script.commands[0])).toBe(true);
    expect(sim.player.id).not.toBe(echo.id);
  });

  it("replays releasing guard and explicitly switching back to the building hand", () => {
    const { sim, history, temporal, enemy } = fixture();
    advance(sim, history, { ...idle(sim.player), weapon: 1, guard: true });
    advance(sim, history, {
      ...idle(sim.player),
      weapon: 0,
      guard: false,
      attack: false,
    });
    expect(branch(temporal, 0).ok).toBe(true);
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    advance(sim, history);
    expect(echo.combat).toMatchObject({ weapon: 1, guarding: true });
    advance(sim, history);
    expect(echo.combat).toMatchObject({ weapon: 0, guarding: false });
    expect(health(sim, enemy.id)).toBe(55);
  });

  it("replays an attack attempt but a new wall changes the fight's outcome", () => {
    const { sim, history, temporal, enemy } = fixture(5.5);
    advance(sim, history, attack(sim));
    expect(enemy.combat!.health).toBe(31);
    expect(branch(temporal, 0)).toMatchObject({ ok: true, branched: true });
    const echo = sim.actors.find((a) => a.kind === "echo")!;
    wall(sim, 8);
    history.record([], true);
    advance(sim, history);
    expect(echo.cursor).toBe(1);
    expect(health(sim, enemy.id)).toBe(55);
    expect(echo.combat!.readyAt).toBeGreaterThan(sim.tick);
    expect(history.latest).toBe(1);
  });

  it("preserves a healthy historical player's state when branching from a defeated future", () => {
    const { sim, history, temporal, enemy } = fixture();
    sim.player.combat = { ...sim.player.combat!, health: 1 };
    enemy.taskUntil = 1;
    enemy.yaw = Math.PI;
    enemy.combat = { ...enemy.combat!, readyAt: 0 };
    history.record([], true);
    advance(sim, history);
    expect(sim.player.combat!.health).toBe(0);
    temporal.enter();
    temporal.traveller.x = 14.5;
    expect(temporal.resume().ok).toBe(false);
    const x = temporal.view.x;
    for (let i = 0; i < 15; i++)
      temporal.update({ ...idle(temporal.view), mx: 1 });
    expect(temporal.view.x).toBeGreaterThan(x);
    temporal.seek(0);
    expect(temporal.resume()).toMatchObject({ ok: true, branched: true });
    expect(sim.player.combat!.health).toBe(1);
    expect(sim.actors.find((a) => a.kind === "echo")!.combat!.health).toBe(1);
    const start = sim.player.x;
    advance(sim, history, { ...idle(sim.player), mx: 1 });
    expect(sim.player.x).toBeGreaterThan(start);
  });
});

describe("combat history storage", () => {
  it("bounds five minutes while the player and three past selves repeatedly raise and lower guards", () => {
    setFlagsFromString("--expose_gc");
    const gc = runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage();
    const sim = new Simulation();
    for (let i = 0; i < 3; i++) {
      const replay = sim.createReplay(
        Array.from({ length: 18000 }, (_, tick) => ({
          ...idle(sim.player),
          weapon: 1,
          attack: false,
          guard: tick % 2 === 0,
        })),
      );
      const echo = actor(sim.nextId++, "echo", 15 + i * 3, 5, 38);
      echo.program = replay.id;
      sim.actors.push(echo);
    }
    const history = new History(sim);
    for (let tick = 0; tick < 18240; tick++)
      advance(sim, history, {
        ...idle(sim.player),
        weapon: 1,
        attack: false,
        guard: tick % 2 === 0,
      });
    const bytes = history.bytes();
    gc();
    const after = process.memoryUsage();
    const retainedMiB =
      (after.heapUsed -
        before.heapUsed +
        after.arrayBuffers -
        before.arrayBuffers) /
      1048576;
    console.info(
      JSON.stringify({
        benchmark:
          "five-minute combat guard-toggle stress, 15 actors, 3 replay scripts",
        estimatedMiB: +(bytes / 1048576).toFixed(2),
        retainedMiB: +retainedMiB.toFixed(2),
        frames: history.frames.size,
      }),
    );
    expect(history.frames.size).toBe(18001);
    const final = sim.snapshot();
    history.seek(history.oldest);
    history.seek(history.latest);
    expect(sim.snapshot()).toEqual(final);
    expect(bytes).toBeLessThan(64 * 1048576);
    expect(retainedMiB).toBeLessThan(64);
  }, 20000);
});
