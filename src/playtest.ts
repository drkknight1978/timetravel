import type { Simulation } from "./simulation";
import type { Temporal } from "./temporal";
import type { History } from "./history";
import type { WorldRenderer } from "./renderer";
import { Block, idle } from "./model";
import { advance } from "./history";
import { blocked } from "./physics";
/** Explicit, development-only scene staging for repeatable browser walkthroughs. */
export function installPlaytest(
  sim: Simulation,
  temporal: Temporal,
  history: History,
  renderer: WorldRenderer,
  start: () => void,
) {
  const panel = document.createElement("div");
  panel.id = "playtest-tools";
  panel.innerHTML =
    "<span>SCENE STAGING · DEV ONLY</span>" +
    ["Camp", "Mira", "Clover", "Berries", "Pond", "Ridge", "Arena", "Hole"]
      .map((n) => `<button>${n}</button>`)
      .join("");
  document.body.append(panel);
  panel.addEventListener("click", (event) => {
    const name = (event.target as HTMLElement).closest("button")?.textContent;
    if (!name) return;
    if (temporal.mode === "temporal") temporal.cancel();
    if (name === "Hole") {
      // Record a real excavation and fall, then preview the intact ground.
      // Public development staging; the rescue still uses the normal controls.
      const x = 12,
        z = 40,
        y = sim.voxels.ground(x, z);
      Object.assign(sim.player, {
        x: x + 0.5,
        y,
        z: z + 0.5,
        yaw: 0,
        pitch: -1.5,
        vy: 0,
      });
      history.record([], true, [sim.playerId]);
      const intact = sim.tick;
      for (let level = y - 1; level >= Math.max(1, y - 4); level--) {
        advance(sim, history, {
          ...idle(sim.player),
          edit: {
            x,
            y: level,
            z,
            block: Block.Air,
            expected: sim.voxels.get(x, level, z),
          },
        });
        for (let i = 0; i < 40; i++) advance(sim, history, idle(sim.player));
      }
      temporal.enter();
      temporal.seek(intact);
      renderer.resetInterpolation();
      start();
      return;
    }
    const target =
      name === "Arena"
        ? (sim.actors.find((a) => a.kind === "enemy" && a.role === 0) ?? {
            x: 35.5,
            y: 5,
            z: 16.5,
          })
        : name === "Mira"
          ? sim.actors.find((a) => a.id === 2)!
          : name === "Clover"
            ? sim.actors.find((a) => a.id === 6)!
            : name === "Berries"
              ? sim.forage[3]
              : name === "Pond"
                ? { x: 9, y: 3, z: 27 }
                : name === "Ridge"
                  ? { x: 25, y: 12, z: 8 }
                  : { x: 30.5, y: 5, z: 42.5 };
    const distance =
      name === "Arena" ? 7 : name === "Pond" || name === "Ridge" ? 5 : 1.8;
    for (const [dx, dz] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      const x = target.x + dx * distance,
        z = target.z + dz * distance,
        y = sim.voxels.ground(x, z),
        p = { x, y, z };
      if (blocked(sim.voxels, p, sim.actors, sim.playerId)) continue;
      Object.assign(sim.player, p, {
        yaw: Math.atan2(-(target.x - x), -(target.z - z)),
        pitch:
          name === "Clover" || name === "Berries" || name === "Camp"
            ? -0.45
            : 0,
        vy: 0,
      });
      history.record([], false, [sim.playerId]);
      renderer.resetInterpolation();
      start();
      break;
    }
  });
}
