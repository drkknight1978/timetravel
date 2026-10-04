/** Bounded conversation data shared by client, server, and immutable history. */
export const MAX_MESSAGE = 500;
export const MAX_REPLY = 1200;
export const MAX_EXCHANGES = 6;
export const MAX_SESSION_EXCHANGES = 12;
export type ConversationSource = "openai" | "local";
export interface ConversationTurn {
  readonly player: string;
  readonly npc: string;
  readonly source: ConversationSource;
  readonly tick: number;
  readonly playerId: number;
}
export interface ConversationBatch {
  readonly epoch: number;
  readonly tick: number;
  readonly npcId: number;
  readonly playerId: number;
  readonly turns: readonly ConversationTurn[];
}
export interface ConversationContext {
  activity: string;
  requestState: number;
  supplies: number[];
  health: number;
  nearbyEnemies: number;
  echoes: number;
  branch: number;
}
export interface ConversationRequest {
  epoch: number;
  tick: number;
  npcId: number;
  playerId: number;
  message: string;
  history: readonly ConversationTurn[];
  context: ConversationContext;
}
export interface ConversationStatus {
  configured: boolean;
  available: boolean;
  calls: number;
  limit: number;
  reason: string;
  model: string;
  estimatedCostUsd: number;
}
export interface ConversationResponse {
  epoch: number;
  tick: number;
  npcId: number;
  playerId: number;
  reply: string;
  source: ConversationSource;
  status: ConversationStatus;
}
export const CONVERSATION_PROFILES: Record<
  number,
  {
    name: string;
    role: string;
    personality: string;
    greeting: string;
    topics: readonly string[];
  }
> = {
  2: {
    name: "Mira",
    role: "Architect",
    personality:
      "Warm, imaginative architect. Loves arches, thoughtful design and welcoming places. Curious about time travel but only knows what the visitor says or the supplied memories contain. Speaks with a little wonder, never grandiose.",
    greeting:
      "Come and have a look. I’m trying to make this place feel like somewhere people belong. What’s on your mind?",
    topics: [
      "What are you building?",
      "What would you change here?",
      "Have we met before?",
    ],
  },
  3: {
    name: "Ash",
    role: "Salvager",
    personality:
      "Practical, dry-humoured salvager. Values useful materials and second chances. Takes structures apart so others can rebuild. Friendly under a matter-of-fact exterior; short, concrete sentences.",
    greeting:
      "Mind the loose timber. Taking things apart is how I work out what they’re worth. Got a question?",
    topics: [
      "Why take things apart?",
      "Any advice about the enemies?",
      "What if we could start again?",
    ],
  },
  4: {
    name: "Tess",
    role: "Mason",
    personality:
      "Steady, thoughtful mason. Values patience, good foundations and honest workmanship. Likes the northern ridge and long views. Reassuring without being sentimental; quietly curious about the visitor.",
    greeting:
      "There’s always time to stop and talk. Even a good wall needs a pause between courses. How are you finding the clearing?",
    topics: [
      "What makes a good foundation?",
      "Tell me about the ridge.",
      "Have you noticed anything strange?",
    ],
  },
  5: {
    name: "Rue",
    role: "Recycler",
    personality:
      "Gentle, observant recycler and wildlife enthusiast. Values patience, reuse and the wellbeing of Clover and Pip the hares and Fern and Rowan the deer. Gives grounded advice and asks considerate questions.",
    greeting:
      "Hello again—or perhaps hello for the first time. The animals seem happy enough today. What would you like to talk about?",
    topics: [
      "How do I befriend the animals?",
      "What do you like about this place?",
      "Can you remember me?",
    ],
  },
};

/** Honest, limited dialogue when generated replies are unavailable; never masquerades as AI. */
export function localConversationReply(request: ConversationRequest): string {
  const p = CONVERSATION_PROFILES[request.npcId] ?? CONVERSATION_PROFILES[2];
  const text = request.message.toLowerCase();
  if (/follow|come with|wait here|stop work|carry on/.test(text))
    return "Use the work buttons beside our conversation to ask me to wait, follow, or carry on. Your choice takes effect when we return to the clearing.";
  if (/remember|met before|last time|my name|who am i/.test(text)) {
    const previous = request.history.at(-1);
    return previous
      ? `I remember you asking, “${previous.player.slice(0, 160)}”. Those words belong to the time we’ve shared here.`
      : "We haven’t shared a conversation in this timeline yet. Tell me a little about yourself.";
  }
  if (/time|rewind|again|past|future/.test(text))
    return (
      [
        "An arch can frame the same view twice, but you might notice something different. What would you do differently?",
        "A second chance is useful. I’d still check where I put my feet before taking it.",
        "If you begin again, keep the good foundations. The rest can change.",
        "If things begin again, be gentle with whoever meets you there. They might not know you yet.",
      ][request.npcId - 2] ?? p.greeting
    );
  if (/enemy|enemies|fight|weapon|sword/.test(text))
    return "The northern ruins are dangerous. The Raider is quick, the Warden has a shield, and the Hunter attacks from a distance. Cover and a different approach can help.";
  if (/animal|hare|deer|berr|clover|pip|fern|rowan/.test(text))
    return "Approach the wildlife slowly and offer berries with E. Clover and Pip are hares; Fern and Rowan are deer. Rue knows them best.";
  if (
    /build|work|job|timber|stone|suppl|foundation|apart|ridge|help/.test(text)
  )
    return (
      [
        `I’m ${request.context.activity.toLowerCase()}. Good paths and welcoming arches are worth making. A little timber helps us get there.`,
        "I reclaim what we can use again. No sense leaving good materials lying in a heap—someone could make something better from them.",
        "Good stone and patient work. That’s where I start. The northern ridge is a good place to think about what should last.",
        "I collect what we can use again and keep an eye on the wildlife. A little patience usually helps more than rushing.",
      ][request.npcId - 2] ?? p.greeting
    );
  return (
    [
      "I like hearing another point of view. What would you like to build—or change—around here?",
      "Fair enough. I’m better with timber than small talk, but I’m listening. What brings you to the clearing?",
      "Let’s take it one thing at a time. Is it the work, the ridge, or something unusual you wanted to discuss?",
      "I’m listening. We could talk about the animals, the clearing, or another chance to do things differently.",
    ][request.npcId - 2] ?? p.greeting
  );
}
