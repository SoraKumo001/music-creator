import { describe, expect, it } from "vitest";
import { parseChord } from "../src/theory/harmony";
import { findParallels, voiceProgression, voicingsFor } from "../src/theory/voicing";

const chords = (symbols: string[]) => symbols.map(parseChord);

describe("voicingsFor", () => {
  it("produces in-range candidates for triads and sevenths", () => {
    for (const symbol of ["C", "Am", "G7", "Fmaj7", "Bm7b5", "C/E"]) {
      const vs = voicingsFor(parseChord(symbol));
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) {
        expect(v.length).toBeGreaterThanOrEqual(3);
        for (const p of v) {
          expect(p).toBeGreaterThanOrEqual(53);
          expect(p).toBeLessThanOrEqual(79);
        }
      }
    }
  });
});

describe("voiceProgression", () => {
  it("keeps every voice in range and ascending", () => {
    const v = voiceProgression(chords(["Cmaj7", "Am7", "Dm7", "G7", "Cmaj7"]));
    for (const voicing of v) {
      for (let i = 1; i < voicing.length; i++) expect(voicing[i]!).toBeGreaterThan(voicing[i - 1]!);
      for (const p of voicing) {
        expect(p).toBeGreaterThanOrEqual(53);
        expect(p).toBeLessThanOrEqual(79);
      }
    }
  });

  it("avoids parallel fifths where an alternative exists", () => {
    const v = voiceProgression(chords(["C", "G", "D", "G", "C"]));
    expect(findParallels(v)).toEqual([]);
  });

  it("keeps common tones between chords", () => {
    const v = voiceProgression(chords(["C", "Am"]));
    const common = v[0]!.filter((p) => v[1]!.includes(p));
    expect(common.length).toBeGreaterThanOrEqual(1);
  });

  it("handles a change of voice count (triad -> seventh)", () => {
    const v = voiceProgression(chords(["C", "Cmaj7", "Fmaj7"]));
    expect(v[0]!.length).toBe(3);
    expect(v[1]!.length).toBe(4);
    expect(findParallels(v)).toEqual([]);
  });

  it("returns an empty array for no chords", () => {
    expect(voiceProgression([])).toEqual([]);
  });
});
