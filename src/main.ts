import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "./style.css";
import { Block, EYE_HEIGHT, HZ, alive, type Command, type Edit } from "./model";
import { History } from "./history";
import { Simulation } from "./simulation";
import { FixedClock, Temporal } from "./temporal";
import { WorldRenderer } from "./renderer";
import { raycast, SITES } from "./world";
import { Sound } from "./audio";
import { CampUI } from "./interactions";
import { type Action } from "./camp";
import { CREW, workerActivity } from "./crew";
import { IntelligenceClient } from "./ai-client";
import { ConversationSession } from "./conversation-client";
import { activeIntent, INTENT_LABELS } from "./intelligence";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<div id="world"></div><div class="vignette"></div>
<header><a class="wordmark" href="#" aria-label="Timetravel"><span class="glyph">⌛</span> timetravel<span class="version">EXPERIMENT 001</span></a><div class="header-right"><span id="state-pill"><i></i> WORLD IS LIVE</span><button id="sound" aria-label="Toggle all sound" aria-pressed="true">SOUND ON</button><button id="npc-ai" aria-label="Toggle NPC AI updates" aria-pressed="true">NPC AI ON</button><button id="help" aria-label="Open controls">?</button></div></header>
<aside id="session"><div class="eyebrow">THE CLEARING</div><div class="session-time"><span id="time">00:00.0</span><span class="time-caption">WORLD TIME</span></div><div class="stats-row"><span>BRANCH <b id="branch">00</b></span><span>PAST SELVES <b id="selves">0 / 3</b></span></div></aside>
<div id="crosshair"><span></span><span></span></div>
<aside id="combat-hud" aria-label="Player health and equipment"><div class="health-heading"><span id="health-caption">HEALTH</span><b id="health-value">100 / 100</b></div><div id="health-meter" role="progressbar" aria-label="Player health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="health-fill"></i></div><div class="equipment-line"><b id="equipment-name">BUILDING</b><span id="equipment-state">Unlimited materials</span></div><p id="combat-guide">Combat · northern ruins<br><kbd>6</kbd> Sword <span>·</span> <kbd>7</kbd> Crossbow</p></aside>
<section id="defeat-panel" role="alert" hidden><span class="eyebrow">THIS OUTCOME CAN CHANGE</span><h2>You fell here.</h2><p>Leave time, move clear and rewind to before the fight.</p><button id="defeat-rewind"><kbd>Q</kbd> LEAVE TIME</button></section>
<aside id="objective"><span class="eyebrow">A SMALL EXPERIMENT</span><p id="objective-copy">Follow a worker. Watch a supply run.</p><div class="objective-progress"><i></i><i></i><i></i><i></i></div><div id="nearby-heading" class="crew-heading">AROUND THE CLEARING</div><div id="crew-list"></div><p id="ai-status" class="ai-status">NPC intelligence · checking local service</p><p id="ai-thought" class="ai-thought"></p></aside>
<div id="toast" role="status"></div>
<section id="temporal-panel" aria-label="Temporal controls" hidden><div class="temporal-heading"><span class="eyebrow">OUTSIDE THE FLOW</span><span id="rewind-speed">2× SPEED</span></div><p id="music-state" class="music-state">♫ MUSIC FROZEN · HOLD R / F</p><div class="timeline"><div id="timeline-fill"></div><div id="timeline-cursor"></div></div><div class="timeline-labels"><span id="history-start">00:00</span><span id="offset">PRESENT</span><span id="history-end">00:00</span></div><div class="temporal-actions"><button id="back-five" aria-label="Rewind five seconds"><kbd>R</kbd> REWIND</button><button id="forward-five" aria-label="Preview forward five seconds"><kbd>F</kbd> FORWARD</button><button id="return-time"><kbd>Q</kbd> RETURN HERE</button><button id="cancel-time"><kbd>C</kbd> CANCEL</button><button id="surface-time" aria-label="Return to clear ground"><kbd>T</kbd> RETURN TO GROUND</button></div><div class="trail-key"><span class="trail-you">━ YOU</span><span class="trail-self">━ PAST SELVES</span><span>━ CREW COLOURS</span><span class="trail-wildlife">━ WILDLIFE</span><span class="trail-enemy">━ ENEMIES</span><span class="trail-future">┄ LATER RECORDING</span></div><p id="return-status">Walk to a new place. Choose an earlier moment.</p></section>
<footer><div class="material-bar" id="materials"><button data-block="4" class="selected"><kbd>1</kbd><i class="wood"></i><span>Timber</span></button><button data-block="3"><kbd>2</kbd><i class="stone"></i><span>Stone</span></button><button data-block="2"><kbd>3</kbd><i class="earth"></i><span>Earth</span></button><button data-block="1"><kbd>4</kbd><i class="grass"></i><span>Grass</span></button><button id="crafted-slot" data-block="9"><kbd>5</kbd><i class="crafted">✦</i><span>Trail lantern</span><b class="stock-count">0</b></button><button data-weapon="1" aria-label="Equip sword, key 6"><kbd>6</kbd><i class="weapon-icon sword-icon">⚔</i><span>Sword</span></button><button data-weapon="2" aria-label="Equip crossbow, key 7"><kbd>7</kbd><i class="weapon-icon bow-icon">⌁</i><span>Crossbow</span></button></div><div class="ability"><button id="time-button"><kbd>Q</kbd><span>STEP OUT OF TIME<small>Find another way through.</small></span><span class="ability-arrow">↗</span></button></div><div class="movement-hint"><kbd>W A S D</kbd> MOVE <span>·</span> <kbd>SPACE</kbd> JUMP <span>·</span> <kbd>ESC</kbd> PAUSE</div></footer>
<div id="menu" class="menu"><div class="menu-content"><div class="eyebrow">A SMALL WORLD. ANOTHER CHANCE.</div><h1>What if you<br>could <em>go back?</em></h1><p class="intro">A peaceful camp. Three enemies in the northern ruins.<br>Build, explore and fight. Step outside time,<br>then return with a chance to change the outcome.</p><button id="start" class="primary">ENTER THE CLEARING <span>↗</span></button><div class="menu-notes"><span><i></i> FIRST PERSON</span><span><i></i> FIVE MINUTES OF HISTORY</span><span><i></i> NO FLYING</span></div><div class="control-grid"><p><kbd>WASD</kbd> Walk <kbd>SPACE</kbd> Jump</p><p><kbd>Q</kbd> Leave / return to time</p><p><kbd>R</kbd> Rewind <kbd>F</kbd> Preview forward</p><p><kbd>1–5</kbd> Build <kbd>6</kbd> Sword <kbd>7</kbd> Crossbow</p><p><kbd>ARROWS</kbd> Look (mouse alternative)</p><p><kbd>SHIFT</kbd> Sprint <kbd>C</kbd> Cancel preview</p><p><kbd>T</kbd> Return to clear ground outside time</p><p><kbd>E</kbd> Talk / gather / feed</p><p><kbd>B</kbd> Craft <kbd>J</kbd> Journal</p><p><kbd>CLICK / V</kbd> Attack <kbd>RIGHT / G</kbd> Sword guard</p><p>Building: <kbd>CLICK</kbd> break · <kbd>RIGHT</kbd> place</p></div><div class="music-control"><label for="music-volume">♫ MUSIC</label><input id="music-volume" aria-label="Music volume" type="range" min="0" max="100" value="45"><output id="music-volume-value" for="music-volume">45%</output><span>Follows the flow of time.</span></div><p class="fine-print">Click to capture your mouse. Escape pauses the world.<br>Your world lasts for this session.</p><button id="reset" class="text-button" hidden>START A FRESH WORLD</button></div><div class="menu-side"><div class="orbit"><span></span><span></span><span></span></div><div class="side-caption">THE PAST IS A PLACE.<br><b>YOU CAN WALK THERE.</b></div></div></div>
<div id="telemetry" hidden></div>`;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const sim = new Simulation(),
  history = new History(sim),
  temporal = new Temporal(sim, history),
  intelligence = new IntelligenceClient(sim, temporal),
  clock = new FixedClock(),
  sound = new Sound();
let renderer: WorldRenderer;
try {
  renderer = new WorldRenderer($("world"), sim, history, temporal);
} catch (error) {
  $("menu").innerHTML =
    `<div class="menu-content"><h1>WebGL is unavailable.</h1><p>Open this game in Chrome or Safari with hardware acceleration enabled.</p><p>${String(error)}</p></div>`;
  throw error;
}
let running = false,
  started = false,
  selected = Block.Wood,
  selectedWeapon = 0,
  pendingAttack = false,
  jump = false,
  pendingEdit: Edit | undefined,
  pendingAction: Action | undefined,
  pendingTimeToggle = false,
  toastUntil = 0;
const tapped = new Set<string>(),
  keys = new Set<string>(),
  mouseButtons = new Set<number>(),
  frameTimes: number[] = [];
let previousFrame = performance.now(),
  lastHUD = 0,
  lastDraw = 0,
  stage = 0,
  lastMemory = 0,
  memoryMiB = 0;
const diagnostics = new URLSearchParams(location.search).has("diagnostics");
function notify(message: string) {
  $("toast").textContent = message;
  toastUntil = performance.now() + 3500;
  $("toast").classList.add("shown");
}
function pause() {
  intelligence.invalidate();
  running = false;
  sound.pause();
  keys.clear();
  tapped.clear();
  jump = false;
  pendingEdit = undefined;
  pendingAction = undefined;
  pendingTimeToggle = false;
  pendingAttack = false;
  mouseButtons.clear();
  clock.reset();
  $("menu").hidden = false;
  $("start").innerHTML = "RETURN TO THE CLEARING <span>↗</span>";
  $("reset").hidden = false;
}
function start() {
  sound.unlock();
  started = true;
  running = true;
  $("menu").hidden = true;
  campUI.hide();
  clock.reset();
  renderer.renderer.domElement.focus();
  renderer.renderer.domElement
    .requestPointerLock()
    ?.catch(() =>
      notify("Mouse capture is unavailable. Drag on the world to look around."),
    );
}
const campUI = new CampUI(
  sim,
  temporal,
  () => {
    intelligence.invalidate();
    running = false;
    sound.pause();
    keys.clear();
    tapped.clear();
    jump = false;
    pendingEdit = undefined;
    pendingAction = undefined;
    pendingTimeToggle = false;
    pendingAttack = false;
    mouseButtons.clear();
    clock.reset();
    document.exitPointerLock();
    $("menu").hidden = true;
  },
  start,
  (a) => {
    pendingAction = a;
  },
  select,
  (npcId, changed) =>
    new ConversationSession(
      sim,
      temporal,
      npcId,
      changed,
      undefined,
      () => intelligence.enabled,
    ),
);
if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("playtest")
) {
  void import("./playtest").then(({ installPlaytest }) =>
    installPlaytest(sim, temporal, history, renderer, start),
  );
}
$("start").onclick = start;
$("reset").onclick = () => location.reload();
$("help").onclick = () => {
  document.exitPointerLock();
  pause();
};
$("sound").onclick = () => {
  sound.enabled = !sound.enabled;
  if (sound.enabled) sound.unlock();
  $("sound").setAttribute("aria-pressed", String(sound.enabled));
  $("sound").textContent = sound.enabled ? "SOUND ON" : "SOUND OFF";
};
$("music-volume").oninput = () => {
  const value = Number($<HTMLInputElement>("music-volume").value);
  sound.musicVolume = value / 100;
  $("music-volume-value").textContent = `${value}%`;
};
function syncMusic(active = running) {
  sound.updateMusic({
    tick: sim.tick,
    running: active,
    temporal: temporal.mode === "temporal",
    direction: Number(keys.has("KeyF")) - Number(keys.has("KeyR")),
    speed: temporal.speed,
    oldest: history.oldest,
    entry: temporal.entryTick,
  });
}
function toggleTime() {
  if (!started || campUI.open) return;
  if (
    temporal.mode === "live" &&
    (pendingAction || pendingEdit || pendingAttack || sim.hasQueuedConversation)
  ) {
    pendingTimeToggle = true;
    return;
  }
  intelligence.invalidate();
  if (temporal.mode === "live") {
    temporal.enter();
    stage = Math.max(stage, 1);
    sound.play("enter");
    notify("You are outside time. Hold R to rewind.");
  } else {
    const result = temporal.resume();
    if (!result.ok) {
      notify(result.reason!);
      sound.play("error");
      return;
    }
    sound.play(result.branched ? "branch" : "return");
    if (result.branched) {
      stage = 3;
      notify("A new branch. Your past self is repeating your old actions.");
    } else notify("Time flows again.");
  }
  renderer.resetInterpolation();
  keys.delete("KeyR");
  keys.delete("KeyF");
  pendingEdit = undefined;
  pendingAction = undefined;
  pendingAttack = false;
  mouseButtons.clear();
  syncMusic();
  updateHUD();
}
function returnToGround() {
  if (!running || temporal.mode !== "temporal") return;
  intelligence.invalidate();
  const result = temporal.returnToSurface();
  renderer.resetInterpolation();
  sound.play(result.ok ? "return" : "error");
  notify(
    result.ok
      ? "On clear ground. Time is still frozen — press Q when ready."
      : result.reason!,
  );
  updateHUD();
}
$("surface-time").onclick = returnToGround;
$("npc-ai").onclick = () => {
  intelligence.setEnabled(!intelligence.enabled);
  updateHUD();
};
$("time-button").onclick = toggleTime;
$("defeat-rewind").onclick = toggleTime;
$("return-time").onclick = toggleTime;
$("cancel-time").onclick = () => {
  intelligence.invalidate();
  temporal.cancel();
  renderer.resetInterpolation();
  sound.play("return");
  syncMusic();
  updateHUD();
};
$("back-five").onclick = () => {
  intelligence.invalidate();
  temporal.seek(sim.tick - 5 * HZ);
  stage = Math.max(stage, 2);
  renderer.resetInterpolation();
  updateHUD();
};
$("forward-five").onclick = () => {
  intelligence.invalidate();
  temporal.seek(sim.tick + 5 * HZ);
  renderer.resetInterpolation();
  updateHUD();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-block]",
))
  button.onclick = () => select(Number(button.dataset.block));
function select(block: Block) {
  selected = block;
  selectedWeapon = 0;
  pendingAttack = false;
  mouseButtons.clear();
  for (const button of document.querySelectorAll<HTMLElement>("[data-weapon]"))
    button.classList.remove("selected");
  for (const button of document.querySelectorAll<HTMLElement>("[data-block]"))
    button.classList.toggle("selected", Number(button.dataset.block) === block);
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-weapon]",
))
  button.onclick = () => equipWeapon(Number(button.dataset.weapon));
function equipWeapon(weapon: number) {
  selectedWeapon = weapon;
  pendingEdit = undefined;
  pendingAttack = false;
  mouseButtons.clear();
  for (const button of document.querySelectorAll<HTMLElement>("[data-block]"))
    button.classList.remove("selected");
  for (const button of document.querySelectorAll<HTMLElement>("[data-weapon]"))
    button.classList.toggle(
      "selected",
      Number(button.dataset.weapon) === weapon,
    );
  updateHUD();
}
let dragging = false,
  dragDistance = 0;
function attemptEdit(button: number) {
  if (!running) return;
  if (temporal.mode === "temporal") {
    notify("The world is frozen. Return to time to build or fight.");
    return;
  }
  if ((sim.player.combat?.health ?? 100) <= 0) {
    notify("Press Q and rewind to a moment before your defeat.");
    return;
  }
  if (selectedWeapon) {
    if (button === 0) pendingAttack = true;
    return;
  }
  const a = temporal.view,
    c = Math.cos(a.pitch),
    direction = {
      x: -Math.sin(a.yaw) * c,
      y: Math.sin(a.pitch),
      z: -Math.cos(a.yaw) * c,
    };
  const hit = raycast(
    sim.voxels,
    { x: a.x, y: a.y + EYE_HEIGHT, z: a.z },
    direction,
  );
  if (!hit) return;
  if (button === 0)
    pendingEdit = {
      x: hit.x,
      y: hit.y,
      z: hit.z,
      block: Block.Air,
      expected: hit.block,
    };
  else if (button === 2)
    pendingEdit = {
      x: hit.x + hit.normal.x,
      y: hit.y + hit.normal.y,
      z: hit.z + hit.normal.z,
      block: selected,
      expected: Block.Air,
    };
}
renderer.renderer.domElement.addEventListener("mousedown", (event) => {
  if (!running) return;
  mouseButtons.add(event.button);
  if (document.pointerLockElement !== renderer.renderer.domElement) {
    dragging = true;
    dragDistance = 0;
    return;
  }
  attemptEdit(event.button);
});
addEventListener("mouseup", (event) => {
  mouseButtons.delete(event.button);
  if (dragging && dragDistance < 5) attemptEdit(event.button);
  dragging = false;
});
addEventListener("mousemove", (event) => {
  if (!running || (!document.pointerLockElement && !dragging)) return;
  dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
  const p = temporal.view;
  p.yaw -= event.movementX * 0.0022;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - event.movementY * 0.0022));
});
addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    if (campUI.open) {
      campUI.close();
      return;
    }
    if (running) {
      document.exitPointerLock();
      pause();
    }
    return;
  }
  if (!running) return;
  if (
    [
      "Space",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyQ",
      "KeyR",
      "KeyF",
      "KeyC",
      "KeyT",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ].includes(event.code)
  )
    event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  tapped.add(event.code);
  if (event.code === "KeyT") {
    returnToGround();
    return;
  }
  if (event.code === "KeyE") {
    event.preventDefault();
    campUI.interact();
    return;
  }
  if (event.code === "KeyB") {
    campUI.craft();
    return;
  }
  if (event.code === "KeyJ") {
    campUI.journal();
    return;
  }
  if (event.code === "Digit6" || event.code === "Digit7") {
    equipWeapon(event.code === "Digit6" ? 1 : 2);
    return;
  }
  if (event.code === "KeyV" && selectedWeapon && temporal.mode === "live")
    pendingAttack = true;
  if (event.code === "Digit5") {
    campUI.equip();
    return;
  }
  if (event.code === "Space") jump = true;
  if (event.code === "KeyQ") toggleTime();
  if (event.code === "KeyC" && temporal.mode === "temporal") {
    $("cancel-time").click();
  }
  if (event.code.startsWith("Digit")) {
    const b = [Block.Wood, Block.Stone, Block.Dirt, Block.Grass][
      Number(event.code.slice(5)) - 1
    ];
    if (b) select(b);
  }
});
addEventListener("keyup", (event) => {
  keys.delete(event.code);
  syncMusic();
});
addEventListener(
  "wheel",
  (event) => {
    if (!running || temporal.mode !== "temporal") return;
    event.preventDefault();
    const speeds = [1, 2, 4, 8],
      i = speeds.indexOf(temporal.speed);
    temporal.speed =
      speeds[Math.max(0, Math.min(3, i + (event.deltaY > 0 ? 1 : -1)))];
    updateHUD();
  },
  { passive: false },
);
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && running) pause();
});
addEventListener("blur", () => {
  if (running) pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (running) pause();
    clock.reset();
  }
});
function command(): Command {
  const held = (key: string) => keys.has(key) || tapped.has(key);
  const a = temporal.view;
  a.yaw += (Number(held("ArrowLeft")) - Number(held("ArrowRight"))) * 0.022;
  a.pitch = Math.max(
    -1.5,
    Math.min(
      1.5,
      a.pitch + (Number(held("ArrowUp")) - Number(held("ArrowDown"))) * 0.022,
    ),
  );
  const forward = Number(held("KeyW")) - Number(held("KeyS")),
    side = Number(held("KeyD")) - Number(held("KeyA"));
  const c: Command = {
    mx: -Math.sin(a.yaw) * forward + Math.cos(a.yaw) * side,
    mz: -Math.cos(a.yaw) * forward - Math.sin(a.yaw) * side,
    yaw: a.yaw,
    pitch: a.pitch,
    jump,
    sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    edit: pendingEdit,
    action: pendingAction,
    weapon: selectedWeapon,
    attack:
      temporal.mode === "live" &&
      selectedWeapon > 0 &&
      (pendingAttack ||
        held("KeyV") ||
        (document.pointerLockElement === renderer.renderer.domElement &&
          mouseButtons.has(0))),
    guard:
      temporal.mode === "live" &&
      selectedWeapon === 1 &&
      (mouseButtons.has(2) || held("KeyG")),
  };
  jump = false;
  pendingEdit = undefined;
  pendingAction = undefined;
  pendingAttack = false;
  tapped.clear();
  return c;
}
function time(tick: number, decimal = false): string {
  const seconds = tick / HZ;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}${decimal ? "." + Math.floor((seconds * 10) % 10) : ""}`;
}
function updateHUD() {
  $("npc-ai").textContent = intelligence.enabled ? "NPC AI ON" : "NPC AI OFF";
  $("npc-ai").setAttribute("aria-pressed", String(intelligence.enabled));
  $("ai-status").textContent = intelligence.lastMessage;
  const thinking = sim.actors
    .filter(
      (a) =>
        alive(a) &&
        activeIntent(a, sim.tick) &&
        Math.hypot(a.x - temporal.view.x, a.z - temporal.view.z) < 18,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - temporal.view.x, a.z - temporal.view.z) -
        Math.hypot(b.x - temporal.view.x, b.z - temporal.view.z),
    )[0];
  const thought = thinking && activeIntent(thinking, sim.tick);
  $("ai-thought").textContent =
    thought && thinking
      ? `${thinking.kind === "worker" ? CREW.find((c) => c.id === thinking.id)?.name : ["Raider", "Warden", "Hunter"][thinking.role]} · ${INTENT_LABELS[thought.action]}`
      : "";
  $("ai-thought").title = thought?.reason ?? "";
  campUI.update(running);
  const out = temporal.mode === "temporal",
    selves = sim.actors.filter((a) => a.kind === "echo").length;
  const health = Math.max(0, sim.player.combat?.health ?? 100);
  const defeated = health === 0;
  $("health-caption").textContent = out ? "HEALTH AT THIS MOMENT" : "HEALTH";
  $("health-value").textContent = `${health} / 100`;
  $("health-fill").style.width = `${health}%`;
  $("health-meter").setAttribute("aria-valuenow", String(health));
  $("combat-hud").classList.toggle("low-health", health <= 30);
  $("defeat-panel").hidden = !running || out || !defeated;
  document.body.classList.toggle("defeated", defeated && !out);
  document.body.classList.toggle(
    "taking-damage",
    !out && sim.tick < (sim.player.combat?.hurtAt ?? -100) + 16,
  );
  $("equipment-name").textContent = ["BUILDING", "SWORD", "CROSSBOW"][
    selectedWeapon
  ];
  $("equipment-state").textContent = out
    ? "Actions frozen"
    : defeated
      ? "Rewind to recover"
      : sim.player.combat?.guarding
        ? "Guarding"
        : selectedWeapon && sim.tick < (sim.player.combat?.readyAt ?? 0)
          ? "Recovering…"
          : selectedWeapon === 2
            ? "Unlimited bolts"
            : selectedWeapon === 1
              ? "Ready"
              : "Unlimited materials";
  $("combat-guide").innerHTML =
    selectedWeapon === 1
      ? "<kbd>CLICK / V</kbd> Strike <span>·</span> <kbd>RIGHT / G</kbd> Guard<br>Face an attack to soften it. Flank the Warden."
      : selectedWeapon === 2
        ? "<kbd>CLICK / V</kbd> Fire <span>·</span> Aim with the crosshair<br>Bolts hit cover. Keep moving between shots."
        : "Combat · northern ruins<br><kbd>6</kbd> Sword <span>·</span> <kbd>7</kbd> Crossbow";
  document.body.classList.toggle("outside", out);
  document.body.classList.toggle("menu-open", !running);
  $("time").textContent = time(sim.tick, true);
  $("branch").textContent = String(temporal.branch).padStart(2, "0");
  $("selves").textContent = `${selves} / 3`;
  $("state-pill").innerHTML =
    `<i></i> ${!running ? "WORLD IS PAUSED" : out ? "OUTSIDE TIME" : "WORLD IS LIVE"}`;
  $("temporal-panel").hidden = !out;
  $("materials").hidden = out;
  $("time-button").innerHTML =
    `<kbd>Q</kbd><span>${out ? "RETURN TO TIME" : "STEP OUT OF TIME"}<small>${out ? "Make this moment your present." : "Find another way through."}</small></span><span class="ability-arrow">↗</span>`;
  const span = temporal.entryTick - history.oldest,
    ratio = span ? Math.max(0, (sim.tick - history.oldest) / span) : 1;
  $("timeline-fill").style.width = `${ratio * 100}%`;
  $("timeline-cursor").style.left = `${ratio * 100}%`;
  $("history-start").textContent = time(history.oldest);
  $("history-end").textContent = time(temporal.entryTick);
  $("offset").textContent =
    out && sim.tick < temporal.entryTick
      ? `−${((temporal.entryTick - sim.tick) / HZ).toFixed(1)} SEC`
      : "PRESENT";
  $("rewind-speed").textContent = `${temporal.speed}× SPEED`;
  const music = sound.musicStatus;
  $("music-state").textContent =
    !sound.enabled || music.volume === 0
      ? "♫ MUSIC MUTED"
      : music.context !== "running"
        ? "♫ MUSIC WAITING FOR PLAYBACK"
        : music.rate < 0
          ? `♫ MUSIC REVERSE · ${Math.abs(music.rate)}×`
          : music.rate > 0
            ? `♫ MUSIC FORWARD · ${music.rate}×`
            : "♫ MUSIC FROZEN · HOLD R / F";
  const problem = out ? temporal.returnProblem() : undefined;
  document.body.classList.toggle("return-blocked", !!problem);
  $("return-status").textContent =
    problem ??
    (sim.tick < temporal.entryTick
      ? "Return here to create a past self and change what happens next."
      : "Walk to a new place. Choose an earlier moment.");
  $("return-status").classList.toggle("blocked", !!problem);
  $("return-time").classList.toggle("blocked", !!problem);
  if (out && sim.tick < temporal.entryTick) stage = Math.max(stage, 2);
  $("objective-copy").textContent =
    !out && (stage === 1 || stage === 2)
      ? "Explore, build, or press Q to try another moment."
      : [
          "Follow a worker. Watch a supply run.",
          "Walk somewhere new. Hold R to go back.",
          "Find a clear return point. Press Q.",
          "Meet your past self. Change its path.",
        ][stage];
  [...document.querySelectorAll(".objective-progress i")].forEach((e, i) =>
    e.classList.toggle("done", i <= stage),
  );
  const threats = sim.actors.filter(
    (a) =>
      a.kind === "enemy" &&
      Math.hypot(a.x - temporal.view.x, a.z - temporal.view.z) < 18,
  );
  if (threats.length && !out)
    $("objective-copy").textContent = defeated
      ? "Press Q. Find a moment before the hit that defeated you."
      : stage === 3
        ? "Fight alongside your past self. Try a different angle."
        : "Watch an attack wind-up. Dodge, guard or change the fight with Q.";
  $("nearby-heading").textContent = threats.length
    ? "THE NORTHERN RUINS"
    : "AROUND THE CLEARING";
  const threatNames = ["Raider", "Warden", "Hunter"],
    threatColours = ["#ff8867", "#e5c17d", "#bfa2ff"],
    threatHints = [
      "Quick strikes · keep your distance",
      "Shielded front · circle behind",
      "Ranged shots · use cover",
    ];
  const crewHTML = threats.length
    ? threats
        .map(
          (a) =>
            `<div class="crew-row enemy-row"><i style="background:${threatColours[a.role]}"></i><div><b>${threatNames[a.role]}<small>${(a.combat?.health ?? 0) <= 0 ? "DEFEATED" : `${a.combat?.health ?? 0} HP`}</small></b><span>${(a.combat?.health ?? 0) <= 0 ? "Rewind before the fight to restore them." : threatHints[a.role]}</span></div></div>`,
        )
        .join("")
    : CREW.map((w) => {
        const a = sim.actors.find((a) => a.id === w.id);
        return a
          ? `<div class="crew-row"><i style="background:${w.colour}"></i><div><b>${w.name}<small>${w.role}</small></b><span>${workerActivity(a, sim.jobs)}${a.cargo ? ` · ${a.cargo} ${a.cargo === 1 ? "block" : "blocks"}` : ""}</span></div></div>`
          : "";
      }).join("");
  if ($("crew-list").innerHTML !== crewHTML)
    $("crew-list").innerHTML = crewHTML;
  if (performance.now() > toastUntil) $("toast").classList.remove("shown");
  const mean = frameTimes.length
    ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    : 0;
  // A visible, opt-in diagnostics panel supports performance checks without exposing hidden state.
  if (diagnostics && performance.now() - lastMemory > 2000) {
    memoryMiB = Number((history.bytes() / 1048576).toFixed(2));
    lastMemory = performance.now();
  }
  if (diagnostics)
    $("telemetry").textContent = JSON.stringify({
      mode: temporal.mode,
      tick: sim.tick,
      oldest: history.oldest,
      latest: history.latest,
      player: [temporal.view.x, temporal.view.y, temporal.view.z].map(
        (n) => +n.toFixed(2),
      ),
      actors: sim.actors.length,
      health,
      weapon: selectedWeapon,
      playerCombat: sim.player.combat,
      intelligence: {
        enabled: intelligence.enabled,
        status: intelligence.status,
        message: intelligence.lastMessage,
        intentions: sim.actors
          .filter((a) => a.instinct || a.plan)
          .map((a) => ({ id: a.id, instinct: a.instinct, plan: a.plan })),
      },
      enemies: sim.actors
        .filter((a) => a.kind === "enemy")
        .map((a) => ({
          id: a.id,
          role: a.role,
          health: a.combat?.health,
          task: a.task,
          position: [a.x, a.y, a.z].map((n) => +n.toFixed(2)),
        })),
      selves,
      branch: temporal.branch,
      historyMiB: memoryMiB,
      fps: mean ? Number((1000 / mean).toFixed(1)) : 0,
      viewport: [innerWidth, innerHeight],
      render: renderer.stats,
      crew: sim.actors
        .filter((a) => a.kind === "worker")
        .map((a) => ({
          id: a.id,
          activity: workerActivity(a, sim.jobs),
          cargo: a.cargo,
          position: [a.x, a.z].map((n) => +n.toFixed(1)),
        })),
      music: sound.musicStatus,
      camp: sim.camp,
      animals: sim.actors
        .filter((a) => a.kind === "animal")
        .map((a) => ({
          id: a.id,
          trust: a.cargo,
          task: a.task,
          position: [a.x, a.y, a.z],
        })),
      jobs: sim.jobs.map((j, i) => ({ name: SITES[i].name, ...j })),
    });
}
if (diagnostics) $("telemetry").hidden = false;
// The title screen is a paused view of the same world; entering starts the recording at zero.
function frame(now: number) {
  intelligence.update(
    running &&
      temporal.mode === "live" &&
      (sim.player.combat?.health ?? 100) > 0,
  );
  const duration = now - previousFrame;
  previousFrame = now;
  if (running && duration < 250) {
    frameTimes.push(duration);
    if (frameTimes.length > 120) frameTimes.shift();
  }
  const alpha = clock.frame(now, running, () => {
    renderer.capturePrevious();
    const c = command();
    temporal.update(c, Number(keys.has("KeyF")) - Number(keys.has("KeyR")));
    if (c.edit && temporal.mode === "live") sound.play("edit");
    if (temporal.mode === "live") {
      const heard = new Set<string>();
      for (const effect of sim.effects) {
        if (
          effect.tick !== sim.tick ||
          heard.has(effect.kind) ||
          Math.hypot(
            effect.from.x - temporal.view.x,
            effect.from.y - temporal.view.y,
            effect.from.z - temporal.view.z,
          ) > 18
        )
          continue;
        sound.play(effect.kind);
        heard.add(effect.kind);
      }
    }
    for (const message of sim.feedback.splice(0)) notify(message);
    if (pendingTimeToggle) {
      pendingTimeToggle = false;
      toggleTime();
    }
  });
  syncMusic(running && duration < 250);
  // Paused menus need only an occasional redraw; hidden tabs need none.
  if (!document.hidden && (running || now - lastDraw >= 100)) {
    renderer.render(running ? alpha : 1, now);
    lastDraw = now;
  }
  if (now - lastHUD > 150) {
    updateHUD();
    lastHUD = now;
  }
  requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);
