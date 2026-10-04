import { WorkerTask, type Actor, type Job } from "./model";
import { blueprintAt } from "./world";
export const CREW = [
  { id: 2, name: "Mira", role: "Architect", colour: "#64f8da" },
  { id: 3, name: "Ash", role: "Salvager", colour: "#ffb36e" },
  { id: 4, name: "Tess", role: "Mason", colour: "#7fbeff" },
  { id: 5, name: "Rue", role: "Recycler", colour: "#ffa4d4" },
] as const;
export function workerActivity(a: Actor, jobs: Job[]): string {
  const shape = blueprintAt(a.site, jobs[a.site].cycle).name.toLowerCase();
  switch (a.task) {
    case WorkerTask.Listen:
      return "Waiting for you";
    case WorkerTask.Follow:
      return "Following your lead";
    case WorkerTask.Fetch:
      return a.taskUntil ? "Collecting supplies" : "Fetching supplies";
    case WorkerTask.Deliver:
      return a.taskUntil ? "Unloading salvage" : "Carrying salvage home";
    case WorkerTask.Build:
      return `Building ${shape}`;
    case WorkerTask.Dismantle:
      return `Reclaiming ${shape}`;
    case WorkerTask.Inspect:
      return "Inspecting the work";
    case WorkerTask.Celebrate:
      return "Job done!";
    default:
      return a.taskUntil ? "Surveying the clearing" : "Exploring the clearing";
  }
}
