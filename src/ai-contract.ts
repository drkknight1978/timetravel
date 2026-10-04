/** Only game facts and a bounded action vocabulary cross the local AI boundary. */
export const AI_ACTIONS = [
  "routine",
  "watch",
  "flee",
  "investigate",
  "engage",
  "flank_left",
  "flank_right",
  "retreat",
  "hold",
] as const;
export type AIAction = (typeof AI_ACTIONS)[number];
export type AILayer = "instinct" | "plan";
export type AISource = "jev" | "openai" | "rules";
export interface NPCObservation {
  actorId: number;
  kind: "worker" | "enemy";
  role: number;
  health: number;
  position: { x: number; y: number; z: number };
  targetId: number;
  targetDistance: number;
  threatDistance: number;
  visible: boolean;
  blocked: boolean;
  allies: number;
  playerArmed: boolean;
  playerHealth: number;
  echoes: number;
  currentAction: string;
  options: AIAction[];
}
export interface AIRequest {
  epoch: number;
  tick: number;
  layer: AILayer;
  npcs: NPCObservation[];
}
export interface AIDecision {
  actorId: number;
  action: AIAction;
  reason: string;
  confidence?: number;
}
export interface ProviderStatus {
  configured: boolean;
  available: boolean;
  calls: number;
  limit: number;
  reason: string;
}
export interface AIStatus {
  jev: ProviderStatus;
  openai: ProviderStatus;
  model: string;
  estimatedCostUsd: number;
}
export interface AIResponse {
  epoch: number;
  tick: number;
  layer: AILayer;
  source: AISource;
  decisions: AIDecision[];
  status: AIStatus;
}
/** Immutable, sparse changes shared by history; no network activity lives in snapshots. */
export interface NpcIntent {
  readonly action: AIAction;
  readonly until: number;
  readonly source: "jev" | "openai";
  readonly reason: string;
  readonly targetId: number;
}
