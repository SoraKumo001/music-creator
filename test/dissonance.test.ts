import { describe, expect, it } from "vitest";
import { assemble } from "../src/compose";
import { PlanSchema, resolveSections } from "../src/plan";
import type { Note } from "../src/score";
import { chordAt, type ChordEvent } from "../src/theory/accompaniment";
import { defaultPriority, findDissonances, pcDistance, reduceDissonances } from "../src/theory/dissonance";

const note = (pitch: number, start: number, duration = 1, velocity = 90): Note => ({ pitch, start, duration, velocity });

describe("findDissonances", () => {
  it("detects a semitone clash between different tracks", () => {
    const tracks = [
      { name: "Melody", channel: 0, notes: [note(64, 0, 2)] },   // E
      { name: "Pad", channel: 4, notes: [note(65, 0, 2)] },      // F
    ];
    const hits = findDissonances(tracks);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.beat).toBe(0);
    expect(pcDistance(hits[0]!.a.pitch, hits[0]!.b.pitch)).toBe(1);
  });

  it("ignores unison, octaves, fifths and short overlaps", () => {
    expect(findDissonances([
      { name: "Melody", channel: 0, notes: [note(64, 0, 2)] },
      { name: "Pad", channel: 4, notes: [note(64, 0, 2)] },
    ])).toHaveLength(0);
    expect(findDissonances([
      { name: "Melody", channel: 0, notes: [note(64, 0, 2)] },
      { name: "Pad", channel: 4, notes: [note(76, 0, 2)] },
    ])).toHaveLength(0);
    expect(findDissonances([
      { name: "Melody", channel: 0, notes: [note(64, 0, 2)] },
      { name: "Pad", channel: 4, notes: [note(71, 0, 2)] },
    ])).toHaveLength(0);
    // 0.05拍しか重ならない音は境界の食い込みとして無視
    expect(findDissonances([
      { name: "Melody", channel: 0, notes: [note(64, 0, 1)] },
      { name: "Pad", channel: 4, notes: [note(65, 0.95, 1)] },
    ])).toHaveLength(0);
  });

  it("ignores drums and same-track notes", () => {
    expect(findDissonances([
      { name: "Drums", channel: 9, notes: [note(64, 0, 2)] },
      { name: "Pad", channel: 4, notes: [note(65, 0, 2)] },
    ])).toHaveLength(0);
    expect(findDissonances([
      { name: "Chords", channel: 1, notes: [note(60, 0, 2), note(61, 0, 2)] },
    ])).toHaveLength(0);
  });
});

describe("reduceDissonances", () => {
  const opts = {
    chordTonesAt: () => [0, 4, 7], // C major
    scaleTonesAt: () => [0, 2, 4, 5, 7, 9, 11],
  };

  it("repitches the lower-priority voice and never touches the melody", () => {
    const melody = [note(64, 0, 2)]; // E (chord tone)
    const tracks = [
      { name: "Melody", channel: 0, notes: melody },
      { name: "Pad", channel: 4, notes: [note(65, 0, 2)] }, // F -> E? 半音
    ];
    const result = reduceDissonances(tracks, opts);
    expect(result.remaining).toHaveLength(0);
    const pad = result.tracks.find((t) => t.name === "Pad")!;
    // 旋律は不変
    expect(result.tracks.find((t) => t.name === "Melody")!.notes).toEqual(melody);
    // パッドは動くか消える
    if (pad.notes.length > 0) {
      expect(pcDistance(pad.notes[0]!.pitch, 64)).toBeGreaterThanOrEqual(2);
    }
  });

  it("drops or trims when no safe pitch exists", () => {
    // 全コードトーンが旋律と半音関係になる極端なケース
    const tracks = [
      { name: "Melody", channel: 0, notes: [note(60, 0, 4)] },
      { name: "Arp", channel: 5, notes: [note(61, 1, 1)] },
    ];
    const result = reduceDissonances(tracks, {
      chordTonesAt: () => [1], // 半音しか候補が無い
      scaleTonesAt: () => [1],
    });
    expect(result.remaining).toHaveLength(0);
    const arp = result.tracks.find((t) => t.name === "Arp")!;
    expect(arp.notes).toHaveLength(0);
  });

  it("keeps priority order: bass outranks pad", () => {
    expect(defaultPriority("Melody")).toBe(0);
    expect(defaultPriority("Bass")).toBe(1);
    expect(defaultPriority("Chords")).toBe(2);
    expect(defaultPriority("Pad")).toBe(5);
    expect(defaultPriority("Arp")).toBe(7);
    const tracks = [
      { name: "Bass", channel: 2, notes: [note(48, 0, 2)] },
      { name: "Pad", channel: 4, notes: [note(49, 0, 2)] },
    ];
    const result = reduceDissonances(tracks, opts);
    expect(result.remaining).toHaveLength(0);
    // ベースは残り、パッド側が動く
    expect(result.tracks.find((t) => t.name === "Bass")!.notes.map((n) => n.pitch)).toEqual([48]);
  });

  it("works on a full assembled arrangement", () => {
    const plan = PlanSchema.parse({
      bpm: 132, key: "C major",
      chords: [[0, "C"], [8, "Am"], [16, "F"], [24, "G"]],
      sections: [
        { name: "A", bars: 4, comp: "strum", bass: "eighths", drums: "rock", energy: 2 },
        { name: "B", bars: 4, comp: "syncopation", bass: "eighths", drums: "rock", energy: 3 },
      ],
    });
    const sections = resolveSections(plan, 8, 4);
    const melody = [72, 71, 69, 67, 64, 65, 67, 72].map((p, i) => note(p, i, 0.9));
    const score = assemble(plan, sections, melody, 8, { texture: true, arp: true });
    const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
    const before = findDissonances(score.tracks.map((t) => ({ name: t.name, channel: t.channel, notes: t.notes })));
    const result = reduceDissonances(
      score.tracks.map((t) => ({ name: t.name, channel: t.channel, notes: t.notes })),
      {
        chordTonesAt: (beat) => chordAt(events, beat).tones,
        scaleTonesAt: () => [0, 2, 4, 5, 7, 9, 11],
      },
    );
    expect(result.fixes.length).toBeGreaterThan(0);
    expect(result.remaining.length).toBeLessThanOrEqual(before.length);
    // 旋律トラックは変更されない
    const beforeMelody = score.tracks.find((t) => t.name === plan.melodyName)!.notes;
    const afterMelody = result.tracks.find((t) => t.name === plan.melodyName)!.notes;
    expect(afterMelody.map((n) => n.pitch)).toEqual(beforeMelody.map((n) => n.pitch));
  });
});
