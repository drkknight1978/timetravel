import {
  ActionType,
  CREW_LINES,
  MATERIALS,
  RECIPES,
  REQUESTS,
  animalName,
  animalActivity,
  type Action,
  type ForageNode,
} from "./camp";
import { CREW, workerActivity } from "./crew";
import {
  ConversationPanel,
  type ConversationFactory,
} from "./conversation-panel";
import { Block, EYE_HEIGHT, bodyHeight, type Actor } from "./model";
import type { Simulation } from "./simulation";
import type { Temporal } from "./temporal";
import { raycast, Voxels } from "./world";
type Target =
  | { kind: "worker" | "animal"; actor: Actor; label: string }
  | { kind: "forage"; node: ForageNode; label: string }
  | { kind: "bench" | "feeder"; index: number; label: string };
export class CampUI {
  private overlay: HTMLDivElement;
  private prompt: HTMLButtonElement;
  private supplies: HTMLDivElement;
  private target?: Target;
  private conversation?: ConversationPanel;
  equipped = 0;
  constructor(
    private sim: Simulation,
    private temporal: Temporal,
    private pause: () => void,
    private resume: () => void,
    private queue: (a: Action) => void,
    private select: (b: Block) => void,
    private conversations?: ConversationFactory,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.id = "camp-overlay";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    document.body.append(this.overlay);
    this.prompt = document.createElement("button");
    this.prompt.id = "interact-prompt";
    this.prompt.hidden = true;
    this.prompt.onclick = () => this.interact();
    document.body.append(this.prompt);
    this.supplies = document.createElement("div");
    this.supplies.id = "camp-supplies";
    document.body.append(this.supplies);
    this.overlay.addEventListener("keydown", (event) => {
      // A draft is never a movement, weapon, or time-travel command.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...this.overlay.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex='0']",
        ),
      ].filter(
        (element) => !element.hidden && element.getClientRects().length > 0,
      );
      const first = focusable[0],
        last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !this.overlay.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !this.overlay.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    });
    this.overlay.addEventListener("keyup", (event) => event.stopPropagation());
    this.overlay.addEventListener("click", (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!b || b.disabled) return;
      if (b.dataset.close !== undefined) {
        this.close();
        return;
      }
      if (b.dataset.craft !== undefined) {
        const i = Number(b.dataset.craft);
        this.equip(i);
        this.act({ type: ActionType.Craft, target: i });
      }
      if (b.dataset.equip !== undefined) {
        this.equip(Number(b.dataset.equip));
        this.close();
      }
      if (b.dataset.action !== undefined)
        this.act({
          type: Number(b.dataset.action),
          target: Number(b.dataset.target),
          value: Number(b.dataset.value ?? 0),
        });
    });
  }
  get open() {
    return !this.overlay.hidden;
  }
  close() {
    this.hide();
    this.resume();
  }
  hide() {
    this.conversation?.dispose();
    this.conversation = undefined;
    this.overlay.hidden = true;
  }
  equip(i = this.equipped) {
    this.equipped = i;
    this.select(RECIPES[i].block);
    const b = document.querySelector<HTMLButtonElement>("#crafted-slot")!;
    b.dataset.block = String(RECIPES[i].block);
    b.innerHTML = `<kbd>5</kbd><i class="crafted">${RECIPES[i].icon}</i><span>${RECIPES[i].name}</span><b class="stock-count">${this.sim.camp.bag[RECIPES[i].slot]}</b>`;
    b.classList.add("selected");
  }
  private act(a: Action) {
    this.close();
    this.queue(a);
  }
  private show(title: string, eyebrow: string, html: string) {
    this.hide();
    this.pause();
    this.overlay.setAttribute("aria-label", title);
    this.overlay.innerHTML = `<section class="camp-card"><button class="camp-close" data-close aria-label="Close and return to the world">×</button><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${html}<p class="camp-footnote">The world waits while you read. <kbd>ESC</kbd> Return to the clearing.</p></section>`;
    this.overlay.hidden = false;
    this.overlay.querySelector<HTMLButtonElement>("button")?.focus();
  }
  private suppliesHTML() {
    return MATERIALS.map(
      (m, i) => `<span><b>${this.sim.camp.bag[i]}</b> ${m}</span>`,
    ).join("");
  }
  craft() {
    if (this.temporal.mode !== "live") return;
    this.show(
      "Make yourself at home.",
      "FIELD KIT · SHARED CAMP SUPPLIES",
      `<div class="resource-summary">${this.suppliesHTML()}</div><div class="recipe-grid">${RECIPES.map(
        (r, i) => {
          const can = r.cost.every((n, k) => this.sim.camp.bag[k] >= n),
            stock = this.sim.camp.bag[r.slot];
          return `<article class="recipe"><div class="recipe-icon" style="color:${r.colour}">${r.icon}</div><div><h3>${r.name}</h3><p>${r.detail}</p><div class="recipe-cost">${r.cost.map((n, k) => (n ? `<span class="${this.sim.camp.bag[k] < n ? "missing" : ""}">${n} ${MATERIALS[k]}</span>` : "")).join("")}</div><div class="recipe-buttons"><button data-craft="${i}" ${can ? "" : "disabled"}>Make & equip</button><button data-equip="${i}" ${stock ? "" : "disabled"}>Equip · ${stock}</button></div></div></article>`;
        },
      ).join(
        "",
      )}</div><p class="camp-note">Forage glowing patches with E. Timber and stone also come from breaking blocks. Your first four building materials remain unlimited.</p>`,
    );
  }
  journal() {
    const p = this.temporal.view;
    this.show(
      "A clearing worth exploring.",
      "JOURNAL · CREW & COUNTRY",
      `<div class="journal-grid"><div><svg class="clearing-map" viewBox="0 0 256 256" role="img" aria-label="Map: pond west, ridge north, meadow south, woods east"><rect width="256" height="256" rx="16" fill="#314638"/><path d="M125 72 V202 M44 152 H214" stroke="#b9ab77" stroke-width="8"/><ellipse cx="39" cy="108" rx="25" ry="35" fill="#5f939a"/><path d="M48 45 L68 15 94 48 120 22 149 54" fill="#86988a"/><g fill="#223e32"><circle cx="213" cy="84" r="21"/><circle cx="229" cy="145" r="18"/><circle cx="187" cy="45" r="15"/></g><g fill="#b4c08a"><circle cx="95" cy="212" r="23"/><circle cx="164" cy="210" r="25"/></g><g fill="#efe4b4" font-family="sans-serif" font-size="10" text-anchor="middle"><text x="128" y="14">N · STONY RIDGE</text><text x="41" y="109">POND</text><text x="213" y="89">WOODS</text><text x="132" y="232">FLOWER MEADOW</text><text x="92" y="98">ARCH</text><text x="170" y="127">LOOKOUT</text><text x="125" y="193">CAMP</text></g><circle cx="${p.x * 4}" cy="${p.z * 4}" r="5" fill="#f5d982" stroke="#233c32" stroke-width="2"/></svg><p class="camp-note">You are the gold dot. Paths lead to the pond, ridge and wildflower meadow. Animals prefer a quiet approach.</p></div><div class="request-list">${REQUESTS.map((r, i) => `<article><span class="request-state">${this.sim.camp.requests[i] === 2 ? "✓ COMPLETE" : this.sim.camp.requests[i] === 1 ? "IN PROGRESS" : `SPEAK TO ${CREW[i].name.toUpperCase()}`}</span><h3>${r.title}</h3><p>${r.detail}</p></article>`).join("")}</div></div><p class="camp-note">Try another outcome: ask a worker to wait, feed an animal, or place a campfire. Leave time, rewind, move clear and return. Supplies, friendships and requests return to that earlier moment, too.</p>`,
    );
  }
  interact() {
    // Let a closed conversation commit before opening another paused session.
    if (this.temporal.mode !== "live" || this.sim.hasQueuedConversation) return;
    this.update(true);
    if (!this.target) return;
    const t = this.target;
    if (t.kind === "forage") {
      this.queue({ type: ActionType.Gather, target: t.node.id });
      return;
    }
    if (t.kind === "bench") {
      this.craft();
      return;
    }
    if (t.kind === "feeder") {
      this.queue({ type: ActionType.Refill, target: t.index });
      return;
    }
    if (t.kind === "worker") {
      const a = t.actor,
        i = a.id - 2,
        r = REQUESTS[i],
        state = this.sim.camp.requests[i];
      const button = (text: string, type: ActionType, value = 0) =>
        `<button data-action="${type}" data-target="${a.id}" data-value="${value}">${text}</button>`;
      const actions = `<div class="request-feature"><span class="eyebrow">${state === 2 ? "A FAVOUR RETURNED" : "A SMALL FAVOUR"}</span><h3>${r.title}</h3><p>${r.detail}</p>${state === 0 ? button("I can help with that", ActionType.Accept) : state === 1 ? button(i === 3 ? "Tell Rue about your new friend" : "Hand over the supplies", ActionType.Deliver) : '<span class="completed">✓ Completed in this timeline</span>'}</div><div class="conversation-options" aria-label="Work orders">${button("Wait here for 20 seconds", ActionType.Order, 1)}${button("Come with me for 30 seconds", ActionType.Order, 2)}${button("Carry on with your work", ActionType.Order, 0)}</div><p class="camp-note">Use these buttons for favours and work orders. Choices take effect when you return to the clearing.</p>`;
      this.show(
        CREW[i].name,
        `${CREW[i].role.toUpperCase()} · ${workerActivity(a, this.sim.jobs)}`,
        this.conversations
          ? `<div class="conversation-layout"><div id="written-conversation"></div><aside class="conversation-sidebar" aria-label="Favours and work orders">${actions}</aside></div>`
          : `<blockquote>“${state === 2 ? r.thanks : CREW_LINES[i]}”</blockquote>${actions}`,
      );
      if (this.conversations) {
        this.overlay
          .querySelector(".camp-card")!
          .classList.add("conversation-card");
        this.overlay.querySelector(".camp-footnote")!.innerHTML =
          "Conversations belong to this timeline. Rewind and they change too. <kbd>ESC</kbd> Return to the clearing.";
        this.conversation = new ConversationPanel(
          this.overlay.querySelector<HTMLElement>("#written-conversation")!,
          a.id,
          this.conversations,
        );
      }
    } else if (t.kind === "animal") {
      const a = t.actor,
        feed = this.sim.camp.bag[3] > 0;
      this.show(
        animalName(a),
        `${a.role === 0 ? "MEADOW HARE" : "WOODLAND DEER"} · ${animalActivity(a)}`,
        `<div class="animal-friend"><span class="animal-symbol">${a.role === 0 ? "❦" : "♧"}</span><h3>${a.cargo ? "A familiar face." : "A curious visitor."}</h3><p>${a.cargo ? "They recognise your gentle approach. Offer a berry and take a quiet walk together." : "Keep your movements gentle. Berries from the meadow can win their trust."}</p><div class="trust" role="img" aria-label="Trust: ${a.cargo} out of 3">${[0, 1, 2].map((i) => `<span class="${i < a.cargo ? "filled" : ""}">♥</span>`).join("")}</div></div><div class="conversation-options"><button data-action="${ActionType.Feed}" data-target="${a.id}" ${feed ? "" : "disabled"}>Offer a berry · ${this.sim.camp.bag[3]} available</button><button data-action="${ActionType.Pet}" data-target="${a.id}" ${a.cargo ? "" : "disabled"}>Gently say hello</button></div><p class="camp-note">A fed animal will follow for a while. Sprinting can frighten a shy visitor. Friendships follow world time.</p>`,
      );
    }
  }
  update(active: boolean) {
    const stock = document.querySelector("#crafted-slot .stock-count");
    if (stock)
      stock.textContent = String(
        this.sim.camp.bag[RECIPES[this.equipped].slot],
      );
    const enabled = active && this.temporal.mode === "live";
    this.supplies.hidden = !active;
    const suppliesMarkup = `<span class="eyebrow">CAMP SUPPLIES</span><div>${this.suppliesHTML()}</div><button id="open-craft"><kbd>B</kbd> FIELD KIT</button><button id="open-journal"><kbd>J</kbd> JOURNAL</button>`;
    if (this.supplies.innerHTML !== suppliesMarkup)
      this.supplies.innerHTML = suppliesMarkup;
    this.supplies.querySelector<HTMLButtonElement>("#open-craft")!.disabled =
      this.temporal.mode !== "live";
    this.supplies.querySelector<HTMLButtonElement>("#open-craft")!.onclick =
      () => this.craft();
    this.supplies.querySelector<HTMLButtonElement>("#open-journal")!.onclick =
      () => this.journal();
    this.target = undefined;
    if (enabled) {
      const a = this.sim.player,
        candidates: { target: Target; score: number }[] = [];
      const candidate = (
        p: { x: number; y: number; z: number },
        target: Target,
      ) => {
        if (!this.sim.canReach(a, p)) return;
        const dx = p.x - a.x,
          dy = p.y - a.y - EYE_HEIGHT,
          dz = p.z - a.z,
          d = Math.hypot(dx, dy, dz) || 1;
        const dot =
          (dx * -Math.sin(a.yaw) * Math.cos(a.pitch) +
            dy * Math.sin(a.pitch) +
            dz * -Math.cos(a.yaw) * Math.cos(a.pitch)) /
          d;
        if (dot > 0.45) candidates.push({ target, score: dot * 4 - d * 0.15 });
      };
      for (const b of this.sim.actors)
        if (b.kind === "worker" || b.kind === "animal")
          candidate(
            { x: b.x, y: b.y + bodyHeight(b) * 0.65, z: b.z },
            {
              kind: b.kind,
              actor: b,
              label:
                b.kind === "worker"
                  ? `Talk to ${CREW[b.id - 2].name}`
                  : `Meet ${animalName(b)}`,
            },
          );
      for (const n of this.sim.forage)
        if (this.sim.forageReady(n))
          candidate(
            { ...n, y: n.y + 0.35 },
            {
              kind: "forage",
              node: n,
              label: `Gather ${MATERIALS[n.kind].toLowerCase()}`,
            },
          );
      const hit = raycast(
        this.sim.voxels,
        { x: a.x, y: a.y + EYE_HEIGHT, z: a.z },
        {
          x: -Math.sin(a.yaw) * Math.cos(a.pitch),
          y: Math.sin(a.pitch),
          z: -Math.cos(a.yaw) * Math.cos(a.pitch),
        },
        3.2,
      );
      if (hit && (hit.block === Block.Workbench || hit.block === Block.Feeder))
        candidates.push({
          score: 5,
          target: {
            kind: hit.block === Block.Workbench ? "bench" : "feeder",
            index: Voxels.index(hit.x, hit.y, hit.z),
            label:
              hit.block === Block.Workbench
                ? "Open the field kit"
                : "Refill feeder · 2 berries",
          },
        });
      candidates.sort((x, y) => y.score - x.score);
      this.target = candidates[0]?.target;
    }
    this.prompt.hidden = !this.target;
    this.prompt.innerHTML = this.target
      ? `<kbd>E</kbd> ${this.target.label}`
      : "";
  }
}
