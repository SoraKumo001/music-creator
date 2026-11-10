import { describe, expect, it } from "vitest";
import { PlanSchema, resolveSections } from "../src/plan";
import { ORCHESTRA_PARTS, generateOrchestra } from "../src/theory/orchestra";

const plan = PlanSchema.parse({
  bpm: 100,
  key: "C major",
  ensemble: "orchestra",
  chords: [[0, "C"], [4, "G7"], [8, "Am"], [12, "F"], [16, "C"], [20, "G7"], [24, "F"], [28, "C"]],
  sections: [{ name: "A", bars: 8, energy: 3 }],
});
const sections = resolveSections(plan, 8, 4);
const melody = [{ pitch: 72, start: 0, duration: 2, velocity: 90 }];
const tracks = generateOrchestra(plan, sections, melody, 8, 4);

describe("orchestra", () => {
  it("creates all 26 parts at full energy", () => {
    expect(ORCHESTRA_PARTS).toHaveLength(26);
    expect(tracks.map((t) => t.name)).toEqual(ORCHESTRA_PARTS.map((p) => p.name));
  });

  it("fits within the 16 MIDI channels", () => {
    const channels = tracks.map((t) => t.channel);
    expect(Math.max(...channels)).toBeLessThanOrEqual(15);
    expect(new Set(channels).size).toBe(16);
    // 打楽器はチャンネル 9 を共有する
    expect(channels.filter((c) => c === 9)).toHaveLength(3);
  });

  it("shares channels between divisi parts", () => {
    const channelOf = (name: string) => tracks.find((t) => t.name === name)!.channel;
    expect(channelOf("Violin I")).toBe(channelOf("Violin II"));
    expect(channelOf("Flute 1")).toBe(channelOf("Flute 2"));
    expect(channelOf("Oboe 1")).toBe(channelOf("Oboe 2"));
    expect(channelOf("Clarinet 1")).toBe(channelOf("Clarinet 2"));
    expect(channelOf("Bassoon 1")).toBe(channelOf("Bassoon 2"));
    expect(channelOf("Horn 1")).toBe(channelOf("Horn 2"));
    expect(channelOf("Trumpet 1")).toBe(channelOf("Trumpet 2"));
    expect(channelOf("Trombone 1")).toBe(channelOf("Trombone 2"));
  });

  it("keeps every note within the part range", () => {
    for (const track of tracks) {
      const part = ORCHESTRA_PARTS.find((p) => p.name === track.name)!;
      for (const n of track.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(part.range[0]);
        expect(n.pitch).toBeLessThanOrEqual(part.range[1]);
      }
    }
  });

  it("gives the melody to the first violin", () => {
    const vln = tracks.find((t) => t.name === "Violin I")!;
    expect(vln.notes.some((n) => n.pitch === 72 && n.start === 0)).toBe(true);
  });

  it("uses fewer parts in a quiet section", () => {
    const quiet = PlanSchema.parse({
      bpm: 70,
      key: "A minor",
      ensemble: "orchestra",
      chords: [[0, "Am"], [4, "F"], [8, "C"], [12, "G"]],
      sections: [{ name: "A", bars: 4, energy: 1 }],
    });
    const quietTracks = generateOrchestra(
      quiet,
      resolveSections(quiet, 4, 4),
      [{ pitch: 69, start: 0, duration: 2, velocity: 80 }],
      4,
      4,
    );
    const names = quietTracks.map((t) => t.name);
    expect(names).toEqual(["Violin I", "Violin II", "Viola", "Cello", "Contrabass"]);
    expect(names).not.toContain("Trumpet 1");
    expect(names).not.toContain("Timpani");
  });
});
