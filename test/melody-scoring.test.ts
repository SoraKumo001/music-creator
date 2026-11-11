import { describe, expect, it } from "vitest";
import { DEFAULT_MELODY_TARGETS, scoreMelody, type MelodyTargets } from "../src/theory/melody";
import type { Note } from "../src/score";

/** 参照コーパスの実測値に近い目標 (range 24, ~7.4 notes/bar, 中央音域77, 順次0.48) */
const corpusTargets: MelodyTargets = { notesPerBar: 7.38, range: 24, medianPitch: 77, stepwiseShare: 0.48 };

const ctx = {
  key: "C major",
  chords: [
    { start: 0, symbol: "C" },
    { start: 4, symbol: "F" },
    { start: 8, symbol: "G" },
    { start: 12, symbol: "C" },
  ],
  bars: 4,
  beatsPerBar: 4,
};

/** コーパスらしいメロディ (広めの音域・順次進行・8分中心) */
function corpusLikeMelody(): Note[] {
  const shape = [65, 67, 69, 72, 74, 76, 77, 79, 81, 79, 77, 76, 74, 72, 72, 74];
  const notes: Note[] = [];
  for (let bar = 0; bar < 4; bar++) {
    for (let i = 0; i < 8; i++) {
      const pitch = shape[(bar * 4 + i) % shape.length]!;
      notes.push({ pitch, start: bar * 4 + i * 0.5, duration: i % 4 === 3 ? 0.5 : 0.45, velocity: 90 });
    }
  }
  return notes;
}

/** 音域が狭く密度も低いメロディ */
function narrowMelody(): Note[] {
  return Array.from({ length: 4 }, (_, bar) => ({
    pitch: 72 + (bar % 2),
    start: bar * 4,
    duration: 3.5,
    velocity: 90,
  }));
}

describe("scoreMelody with corpus-derived targets", () => {
  it("prefers a corpus-like melody over a narrow, sparse one", () => {
    const good = scoreMelody(corpusLikeMelody(), ctx, corpusTargets);
    const bad = scoreMelody(narrowMelody(), ctx, corpusTargets);
    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.parts.density!).toBeGreaterThan(bad.parts.density!);
    expect(good.parts.range!).toBeGreaterThan(bad.parts.range!);
  });

  it("remains deterministic for the same input", () => {
    const a = scoreMelody(corpusLikeMelody(), ctx, corpusTargets);
    const b = scoreMelody(corpusLikeMelody(), ctx, corpusTargets);
    expect(a).toEqual(b);
  });

  it("falls back to the hand-tuned targets when none are given", () => {
    const withDefault = scoreMelody(narrowMelody(), ctx, DEFAULT_MELODY_TARGETS);
    const withCorpus = scoreMelody(narrowMelody(), ctx, corpusTargets);
    // どちらも 0-100 の範囲で、目標が違えば点数も変わる
    expect(withDefault.total).toBeGreaterThan(0);
    expect(withCorpus.total).not.toBe(withDefault.total);
  });
});
