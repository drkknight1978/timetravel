import { Block, type Actor, type Vec3 } from "./model";
import type { ConversationTurn } from "./conversation-contract";

export enum ActionType {
  Gather = 1,
  Craft,
  Order,
  Accept,
  Deliver,
  Feed,
  Pet,
  Refill,
}
export interface Action {
  type: ActionType;
  target: number;
  value?: number;
}
export interface WorkerOrder {
  mode: number;
  owner: number;
  until: number;
}
export interface Feeder {
  index: number;
  until: number;
}
/** Immutable between interactions; history frames share this state safely. */
export interface CampState {
  readonly bag: readonly number[];
  readonly requests: readonly number[];
  readonly harvested: Readonly<Record<number, number>>;
  readonly orders: readonly WorkerOrder[];
  readonly feeders: readonly Feeder[];
  readonly conversations: Readonly<Record<number, readonly ConversationTurn[]>>;
}
export const MATERIALS = ["Timber", "Stone", "Fibre", "Berries"] as const;
export const RECIPES = [
  {
    name: "Trail lantern",
    block: Block.Lantern,
    slot: 4,
    cost: [2, 1, 1, 0],
    icon: "✦",
    detail: "A warm light for paths and camp. Place with right click.",
    colour: "#ffd080",
  },
  {
    name: "Campfire",
    block: Block.Campfire,
    slot: 5,
    cost: [3, 2, 0, 0],
    icon: "♨",
    detail: "Build a glowing gathering place. Its flame follows world time.",
    colour: "#efae76",
  },
  {
    name: "Wildflower planter",
    block: Block.Planter,
    slot: 6,
    cost: [2, 1, 2, 0],
    icon: "✿",
    detail: "Bring the meadow home with a little flower garden.",
    colour: "#deacd0",
  },
  {
    name: "Wildlife feeder",
    block: Block.Feeder,
    slot: 7,
    cost: [3, 0, 1, 2],
    icon: "♧",
    detail:
      "Attracts nearby animals for a minute. E refills it with two berries.",
    colour: "#b7d99c",
  },
] as const;
export const REQUESTS = [
  {
    title: "A little timber",
    need: [4, 0, 0, 0],
    reward: 4,
    quantity: 1,
    detail: "Bring Mira 4 timber. She will make you a trail lantern.",
    thanks:
      "Perfect. Here’s a lantern for your next adventure. Try lighting the pond path.",
  },
  {
    title: "A place to gather",
    need: [2, 0, 3, 0],
    reward: 5,
    quantity: 1,
    detail: "Bring Ash 2 timber and 3 fibre. He will help you make a campfire.",
    thanks: "That’ll do nicely. Find us a good spot for this campfire.",
  },
  {
    title: "Something that lasts",
    need: [0, 4, 0, 0],
    reward: 6,
    quantity: 1,
    detail: "Bring Tess 4 stone. She will trade you a wildflower planter.",
    thanks:
      "Good stone, good foundations. This planter should brighten the clearing.",
  },
  {
    title: "A gentler approach",
    need: [0, 0, 0, 0],
    reward: 7,
    quantity: 1,
    detail:
      "Feed an animal twice, then return to Rue. She will give you a wildlife feeder.",
    thanks: "See? A little patience. This feeder will help them feel at home.",
  },
] as const;
export const CREW_LINES = [
  "I like making things people can walk through. A gate, a bridge… perhaps even a moment in time.",
  "Nothing here is wasted. I take it apart so someone can make something new. Unless you have another idea?",
  "A good lookout changes how you see a place. There’s a stony ridge to the north, if you fancy a climb.",
  "Walk slowly around the wildlife. Feed them berries and they might follow you. Sprinting can frighten them.",
] as const;
export function initialCamp(): CampState {
  return {
    bag: [3, 2, 2, 2, 0, 0, 0, 0],
    requests: [0, 0, 0, 0],
    harvested: {},
    orders: Array.from({ length: 4 }, () => ({ mode: 0, owner: 0, until: 0 })),
    feeders: [],
    conversations: Object.freeze({}),
  };
}
export interface ForageNode extends Vec3 {
  id: number;
  kind: number;
}
export const FORAGE_SPOTS: readonly [number, number, number][] = [
  [27, 43, 0],
  [34, 43, 1],
  [28, 46, 2],
  [35, 45, 3],
  [22, 43, 3],
  [20, 46, 2],
  [12, 35, 3],
  [9, 28, 2],
  [14, 22, 0],
  [12, 15, 1],
  [23, 13, 1],
  [31, 12, 0],
  [40, 16, 2],
  [48, 16, 1],
  [51, 23, 3],
  [54, 36, 0],
  [48, 44, 1],
  [44, 49, 3],
  [35, 52, 2],
  [25, 54, 0],
  [17, 51, 3],
  [10, 43, 2],
];
export const ANIMAL_NAMES = ["Clover", "Pip", "Fern", "Rowan"] as const;
export function animalName(a: Actor): string {
  return ANIMAL_NAMES[(a.id - 6) % 4] ?? "Wild visitor";
}
export function animalActivity(a: Actor): string {
  if (a.task === 2) return "Following a friend";
  if (a.task === 3) return "Startled — give them space";
  if (a.task === 4) return "Enjoying a snack";
  return a.moving
    ? "Exploring"
    : a.role === 0
      ? "Sniffing the meadow"
      : "Grazing";
}
export const recipeFor = (block: Block) =>
  RECIPES.find((r) => r.block === block);
