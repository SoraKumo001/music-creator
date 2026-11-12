import { describe, expect, it } from "vitest";
import { normalizeScore, warpBeat } from "../src/normalize";
import type { Score } from "../src/score";

describe("warpBeat and swing normalization", () => {
  it("warps off-beat 8ths forward while keeping beat boundaries intact", () => {
    expect(warpBeat(0, 0.5)).toBe(0);
    expect(warpBeat(0.5, 0.5)).toBeCloseTo(0.75, 5);
    expect(warpBeat(1, 0.5)).toBe(1);
    expect(warpBeat(0.5, 0)).toBe(0.5);
  });

  it("lengthens on-beat 8ths and trims off-beat 8ths so swung notes do not overlap the next beat", () => {
    const score: Score = {
      title: "Swing Test",
      bpm: 120,
      timeSignature: [4, 4],
      key: "C major",
      tracks: [
        {
          name: "Melody",
          program: 0,
          channel: 0,
          notes: [
            { pitch: 60, start: 0, duration: 0.5, velocity: 90 },
            { pitch: 62, start: 0.5, duration: 0.5, velocity: 85 },
            { pitch: 64, start: 1, duration: 1, velocity: 90 },
          ],
        },
        {
          name: "Drums",
          program: 0,
          channel: 9,
          notes: [{ pitch: 42, start: 0.5, duration: 0.25, velocity: 80 }],
        },
      ],
    };

    const out = normalizeScore(score, 4, { swing: 0.5 });
    const mel = out.tracks[0]!.notes;
    // On-beat 8th extends to meet the swung off-beat at 0.75
    expect(mel[0]!.start).toBe(0);
    expect(mel[0]!.duration).toBe(0.75);
    // Off-beat 8th starts at 0.75 and ends cleanly at 1.0 (duration 0.25)
    expect(mel[1]!.start).toBe(0.75);
    expect(mel[1]!.duration).toBe(0.25);
    // Quarter note on beat 1 is unaffected
    expect(mel[2]!.start).toBe(1);
    expect(mel[2]!.duration).toBe(1);
    // Drums are not warped
    expect(out.tracks[1]!.notes[0]!.start).toBe(0.5);
  });
});
