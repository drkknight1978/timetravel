import { HZ } from "./model";

export const MUSIC_SAMPLE_RATE = 24000;
export const MUSIC_SECONDS = 40; // Sixteen bars at 96 BPM.
const TAU = Math.PI * 2;
export const wrap = (time: number, duration: number) =>
  ((time % duration) + duration) % duration;

export interface MusicTime {
  tick: number;
  running: boolean;
  temporal: boolean;
  direction: number;
  speed: number;
  oldest: number;
  entry: number;
}

export function musicRate(time: MusicTime): number {
  if (!time.running) return 0;
  if (!time.temporal) return 1;
  if (time.direction < 0 && time.tick > time.oldest) return -time.speed;
  if (time.direction > 0 && time.tick < time.entry) return time.speed;
  return 0;
}

export function bufferOffset(
  seconds: number,
  rate: number,
  duration: number,
  sampleRate: number,
): number {
  const phase = wrap(seconds, duration);
  // Reversed sample zero is the ORIGINAL final sample, not the loop endpoint.
  return rate < 0 ? wrap(duration - phase - 1 / sampleRate, duration) : phase;
}

/** Original, deterministic score: warm pads, a bell motif, bass and soft pulses.
 * Render once; wrap note tails and delay taps across the seam for a continuous loop.
 * No random simulation state, network requests, or copyrighted recordings.
 */
export function composeMusic(sampleRate = MUSIC_SAMPLE_RATE): Float32Array[] {
  const length = Math.round(MUSIC_SECONDS * sampleRate);
  const left = new Float32Array(length),
    right = new Float32Array(length);
  const beat = 60 / 96;
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  function note(
    start: number,
    duration: number,
    midi: number,
    level: number,
    kind: "pad" | "bell" | "bass" | "pulse",
    pan = 0,
  ) {
    const count = Math.ceil(duration * sampleRate),
      offset = Math.round(start * sampleRate);
    const f = frequency(midi),
      l = Math.sqrt((1 - pan) / 2),
      r = Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate,
        phase = TAU * f * t;
      const release = Math.min(1, (duration - t) / 0.12);
      let value: number;
      if (kind === "pad") {
        const env = Math.sin((Math.PI * t) / duration) ** 1.4;
        value =
          env *
          (Math.sin(phase) +
            0.22 * Math.sin(phase * 1.002) +
            0.12 * Math.sin(phase * 2));
      } else if (kind === "bell") {
        const env = Math.min(1, t / 0.009) * Math.exp(-t * 3.6) * release;
        value =
          env *
          (Math.sin(phase) + 0.32 * Math.exp(-t * 5) * Math.sin(phase * 3));
      } else if (kind === "bass") {
        const env = Math.min(1, t / 0.018) * Math.exp(-t * 2.5) * release;
        value = env * (Math.sin(phase) + 0.15 * Math.sin(phase * 2));
      } else {
        const env = Math.min(1, t / 0.005) * Math.exp(-t * 25) * release;
        value = env * Math.sin(TAU * (65 * t + 1.5 * (1 - Math.exp(-t * 40))));
      }
      value *= level;
      const index = (offset + i) % length;
      left[index] += value * l;
      right[index] += value * r;
      if (kind === "bell") {
        for (let echo = 1; echo <= 3; echo++) {
          const delayed =
            (index + Math.round(beat * 0.75 * echo * sampleRate)) % length;
          const decay = 0.25 ** echo;
          left[delayed] += value * decay * (echo % 2 ? r : l);
          right[delayed] += value * decay * (echo % 2 ? l : r);
        }
      }
    }
  }
  const chords = [
    [57, 60, 64, 71],
    [53, 57, 60, 64],
    [48, 55, 59, 64],
    [55, 59, 62, 69],
  ];
  const melody = [
    [76, 71, 72, 64, 71, 76],
    [72, 69, 64, 67, 69, 72],
    [71, 67, 64, 62, 67, 74],
    [74, 71, 69, 67, 62, 71],
  ];
  for (let bar = 0; bar < 16; bar++) {
    const start = bar * 4 * beat,
      chord = chords[Math.floor(bar / 2) % 4];
    if (bar % 2 === 0)
      chord.forEach((midi, i) =>
        note(start, beat * 8.6, midi, 0.055, "pad", (i - 1.5) * 0.4),
      );
    for (let b = 0; b < 4; b++) {
      note(start + b * beat, 0.22, 36, 0.08, "pulse");
      if (b % 2 === 0)
        note(start + b * beat, beat * 1.7, chord[0] - 12, 0.12, "bass");
    }
    const phrase = melody[Math.floor(bar / 2) % 4];
    for (let n = 0; n < 3; n++) {
      const midi = phrase[(bar % 2) * 3 + n] + (bar >= 8 && n === 2 ? 12 : 0);
      note(
        start + [0.5, 1.5, 3][n] * beat,
        1.65,
        midi,
        0.15,
        "bell",
        n === 1 ? -0.4 : 0.4,
      );
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++)
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = 0.65 / Math.max(peak, 0.65);
  for (const channel of [left, right])
    for (let i = 0; i < length; i++) channel[i] *= gain;
  return [left, right];
}

export function reverseSamples(samples: Float32Array): Float32Array {
  return samples.slice().reverse();
}

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  rate: number;
  seconds: number;
  started: number;
};

/** The audio is a read-only view of simulation time; it never enters history.
 * Web Audio does not portably accept negative rates, so use a reversed buffer.
 */
export class Music {
  private readonly forward: AudioBuffer;
  private readonly backward: AudioBuffer;
  private readonly output: GainNode;
  private voice?: Voice;
  private seconds = 0;
  private level = 0.45;
  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
  ) {
    const channels = composeMusic();
    this.forward = context.createBuffer(
      2,
      channels[0].length,
      MUSIC_SAMPLE_RATE,
    );
    this.backward = context.createBuffer(
      2,
      channels[0].length,
      MUSIC_SAMPLE_RATE,
    );
    channels.forEach((channel, i) => {
      this.forward.getChannelData(i).set(channel);
      this.backward.getChannelData(i).set(reverseSamples(channel));
    });
    this.output = context.createGain();
    this.output.gain.value = this.level;
    this.output.connect(destination);
  }
  set volume(value: number) {
    this.level = Math.max(0, Math.min(1, value));
    this.output.gain.setTargetAtTime(
      this.level,
      this.context.currentTime,
      0.015,
    );
  }
  get status() {
    return {
      rate: this.voice?.rate ?? 0,
      position: +wrap(this.seconds, MUSIC_SECONDS).toFixed(2),
      volume: this.level,
      context: this.context.state,
    };
  }
  sync(time: MusicTime): void {
    this.seconds = time.tick / HZ;
    const rate = this.context.state === "running" ? musicRate(time) : 0;
    const now = this.context.currentTime;
    if (!rate) {
      this.stop();
      return;
    }
    const voice = this.voice;
    if (voice) {
      const expected = voice.seconds + (now - voice.started) * voice.rate;
      // Fixed ticks and browser audio use separate clocks. Correct discontinuities
      // and meaningful drift; do not restart for ordinary sub-tick jitter.
      if (
        voice.rate === rate &&
        Math.abs(expected - this.seconds) <
          Math.max(0.07, Math.abs(rate) * 0.04)
      )
        return;
    }
    this.stop();
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = rate < 0 ? this.backward : this.forward;
    source.loop = true;
    source.playbackRate.value = Math.abs(rate);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.015);
    source.connect(gain);
    gain.connect(this.output);
    this.voice = { source, gain, rate, seconds: this.seconds, started: now };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.voice?.source === source) this.voice = undefined;
    };
    source.start(
      now,
      bufferOffset(this.seconds, rate, MUSIC_SECONDS, MUSIC_SAMPLE_RATE),
    );
    // Stop at recorded history boundaries even if the next animation frame is late.
    if (time.temporal) {
      const ticksLeft =
        rate < 0 ? time.tick - time.oldest : time.entry - time.tick;
      source.stop(now + ticksLeft / HZ / Math.abs(rate));
    }
  }
  stop(): void {
    if (!this.voice) return;
    const { source, gain } = this.voice,
      now = this.context.currentTime;
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.linearRampToValueAtTime(0, now + 0.015);
    source.stop(now + 0.016);
    this.voice = undefined;
  }
}
