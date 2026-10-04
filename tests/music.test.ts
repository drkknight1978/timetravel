import { describe, expect, it, vi } from "vitest";
import {
  Music,
  MUSIC_SECONDS,
  bufferOffset,
  composeMusic,
  musicRate,
  reverseSamples,
  type MusicTime,
} from "../src/music";

const time = (changes: Partial<MusicTime> = {}): MusicTime => ({
  tick: 900,
  running: true,
  temporal: false,
  direction: 0,
  speed: 2,
  oldest: 120,
  entry: 1800,
  ...changes,
});

// A small Web Audio graph double checks transport scheduling; real browser
// rendering is verified separately, so it is not mistaken for audio support.
function audioGraph() {
  const param = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const gain = () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() });
  const sources: Array<ReturnType<typeof source>> = [];
  const source = () => ({
    buffer: undefined as undefined | AudioBuffer,
    loop: false,
    playbackRate: param(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: undefined as undefined | (() => void),
  });
  const context = {
    currentTime: 0,
    state: "running",
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        getChannelData: (i: number) => data[i],
        duration: length / sampleRate,
        sampleRate,
      };
    },
    createGain: gain,
    createBufferSource() {
      const s = source();
      sources.push(s);
      return s;
    },
  };
  const music = new Music(
    context as unknown as AudioContext,
    gain() as unknown as AudioNode,
  );
  return { music, context, sources };
}

describe("music follows world time", () => {
  it("uses normal playback live, selected signed speed in preview and silence when frozen", () => {
    expect(musicRate(time())).toBe(1);
    for (const speed of [1, 2, 4, 8]) {
      expect(musicRate(time({ temporal: true, direction: -1, speed }))).toBe(
        -speed,
      );
      expect(musicRate(time({ temporal: true, direction: 1, speed }))).toBe(
        speed,
      );
    }
    expect(musicRate(time({ temporal: true }))).toBe(0);
    expect(musicRate(time({ running: false, direction: -1 }))).toBe(0);
    expect(musicRate(time({ temporal: true, tick: 120, direction: -1 }))).toBe(
      0,
    );
    expect(musicRate(time({ temporal: true, tick: 1800, direction: 1 }))).toBe(
      0,
    );
  });
  it("maps both directions to the identical original sample, including loop seams", () => {
    const original = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const reversed = reverseSamples(original);
    expect(original[0]).toBeCloseTo(0.1);
    for (let tick = 0; tick < 30; tick++) {
      const position = tick / 5;
      const index = Math.round(bufferOffset(position, -8, 1, 5) * 5) % 5;
      expect(reversed[index]).toBe(original[tick % 5]);
    }
    expect(bufferOffset(45, 1, MUSIC_SECONDS, 24000)).toBe(5);
  });
  it("renders a finite stereo loop without clipping or a discontinuity at the seam", () => {
    const samples = composeMusic();
    expect(samples).toHaveLength(2);
    for (const channel of samples) {
      expect(channel.length).toBe(40 * 24000);
      let peak = 0,
        energy = 0;
      for (const sample of channel) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      expect(peak).toBeLessThanOrEqual(0.651);
      expect(Math.sqrt(energy / channel.length)).toBeGreaterThan(0.025);
      expect(Math.abs(channel[0] - channel.at(-1)!)).toBeLessThan(0.04);
    }
    expect(samples[0]).not.toEqual(samples[1]);
  });
  it("plays the reverse buffer at positive Web Audio rates and stops exactly at history edges", () => {
    const { music, sources } = audioGraph();
    for (const speed of [1, 2, 4, 8]) {
      music.sync(time({ temporal: true, direction: -1, speed }));
      const s = sources.at(-1)!;
      expect(s.playbackRate.value).toBe(speed);
      expect(s.loop).toBe(true);
      expect(s.start).toHaveBeenCalledWith(
        0,
        expect.closeTo(25 - 1 / 24000, 10),
      );
      expect(s.stop).toHaveBeenCalledWith(13 / speed);
    }
    const reverseBuffer = sources.at(-1)!.buffer!;
    music.sync(time({ temporal: true, direction: 1, speed: 4 }));
    const forwardBuffer = sources.at(-1)!.buffer!;
    const f = forwardBuffer.getChannelData(0),
      r = reverseBuffer.getChannelData(0);
    for (const i of [0, 100, 89991, f.length - 1])
      expect(r[i]).toBe(f[f.length - i - 1]);
    expect(sources.at(-1)!.stop).toHaveBeenCalledWith(15 / 4);
  });
  it("does not restart for ordinary frames, but reanchors after jumps, cancel and branches", () => {
    const { music, context, sources } = audioGraph();
    music.sync(time());
    context.currentTime = 0.5;
    music.sync(time({ tick: 930 }));
    expect(sources).toHaveLength(1);
    music.sync(time({ temporal: true, tick: 600, direction: -1 }));
    expect(sources.at(-1)!.start).toHaveBeenLastCalledWith(
      0.5,
      expect.closeTo(30 - 1 / 24000, 10),
    );
    context.currentTime = 1;
    music.sync(time({ temporal: true, tick: 540, direction: -1 }));
    expect(sources).toHaveLength(2);
    music.sync(time({ tick: 1800 })); // Cancel to entry.
    expect(sources.at(-1)!.start).toHaveBeenLastCalledWith(1, 30);
    music.sync(time({ tick: 300 })); // Return into the past.
    expect(sources.at(-1)!.start).toHaveBeenLastCalledWith(1, 5);
    expect(sources.at(-1)!.playbackRate.value).toBe(1);
  });
  it("stops on pause and freeze, survives suspended audio, and resumes without catch-up", () => {
    const { music, context, sources } = audioGraph();
    music.sync(time());
    music.sync(time({ running: false }));
    expect(music.status.rate).toBe(0);
    expect(sources[0].stop).toHaveBeenCalledWith(0.016);
    context.currentTime = 100;
    music.sync(time());
    expect(sources.at(-1)!.start).toHaveBeenLastCalledWith(100, 15);
    music.sync(time({ temporal: true }));
    expect(music.status.rate).toBe(0);
    context.state = "suspended";
    music.sync(time());
    expect(sources).toHaveLength(2);
    context.state = "running";
    music.sync(time());
    music.volume = 0;
    expect(music.status.volume).toBe(0);
    sources[0].onended?.(); // A fading OLD voice must not clear the current one.
    expect(music.status.rate).toBe(1);
  });
});
