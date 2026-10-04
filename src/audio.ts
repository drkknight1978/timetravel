import { Music, type MusicTime } from "./music";

export class Sound {
  private audible = true;
  private context?: AudioContext;
  private master?: GainNode;
  private music?: Music;
  private musicLevel = 0.45;
  get enabled() {
    return this.audible;
  }
  set enabled(value: boolean) {
    this.audible = value;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        value ? 1 : 0,
        this.context.currentTime,
        0.015,
      );
  }
  set musicVolume(value: number) {
    this.musicLevel = Math.max(0, Math.min(1, value));
    if (this.music) this.music.volume = this.musicLevel;
  }
  get musicStatus() {
    return (
      this.music?.status ?? {
        rate: 0,
        position: 0,
        volume: this.musicLevel,
        context: "not started",
      }
    );
  }
  /** Called from a user gesture, including the first Enter the clearing click. */
  unlock(): void {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.audible ? 1 : 0;
        this.master.connect(this.context.destination);
        this.music = new Music(this.context, this.master);
        this.music.volume = this.musicLevel;
      }
      void this.context.resume().catch(() => {
        /* Browser may deny audio. */
      });
    } catch {
      /* Sound is optional; the game still works without Web Audio. */
    }
  }
  updateMusic(time: MusicTime): void {
    this.music?.sync(time);
  }
  pause(): void {
    this.music?.stop();
  }
  play(
    kind:
      | "enter"
      | "return"
      | "branch"
      | "edit"
      | "error"
      | "slash"
      | "bolt"
      | "hit"
      | "guard"
      | "defeat",
  ): void {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context || !this.master) return;
    const ctx = this.context,
      osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      now = ctx.currentTime;
    const [start, end, duration] =
      kind === "enter"
        ? [480, 110, 0.4]
        : kind === "branch"
          ? [160, 680, 0.55]
          : kind === "return"
            ? [220, 480, 0.25]
            : kind === "error"
              ? [100, 75, 0.15]
              : kind === "slash"
                ? [330, 70, 0.13]
                : kind === "bolt"
                  ? [700, 140, 0.1]
                  : kind === "hit"
                    ? [130, 40, 0.12]
                    : kind === "guard"
                      ? [920, 350, 0.19]
                      : kind === "defeat"
                        ? [210, 48, 0.5]
                        : [260, 170, 0.055];
    osc.type = ["edit", "slash", "bolt", "hit", "guard"].includes(kind)
      ? "triangle"
      : "sine";
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(now);
    osc.stop(now + duration);
  }
}
