import { describe, expect, it } from "vitest";
import { GENRES } from "../src/knowledge/genres";
import { PROGRESSIONS, cardsForGenre, progressionById, realizeCard } from "../src/knowledge/progressions";
import { degreePc } from "../src/theory/key";
import { analyzeChord, parseNumeral } from "../src/theory/roman";

const ROOTS = Array.from({ length: 12 }, (_, i) => i);

describe("progression library", () => {
  it("has unique ids and consistent lengths", () => {
    const ids = new Set<string>();
    for (const card of PROGRESSIONS) {
      expect(ids.has(card.id)).toBe(false);
      ids.add(card.id);
      expect(card.bars * card.harmonicRhythm).toBe(card.numerals.length);
      expect(card.tempo[0]).toBeLessThanOrEqual(card.tempo[1]);
      expect(card.genres.length).toBeGreaterThan(0);
    }
    expect(PROGRESSIONS.length).toBeGreaterThanOrEqual(30);
  });

  it("covers many genres", () => {
    const genres = new Set(PROGRESSIONS.flatMap((c) => c.genres));
    expect(genres.size).toBeGreaterThanOrEqual(12);
  });

  it("realizes every card correctly in every key of its mode", () => {
    for (const card of PROGRESSIONS) {
      for (const root of ROOTS) {
        const key = { root, mode: card.mode };
        const symbols = realizeCard(card, key);
        expect(symbols).toHaveLength(card.numerals.length);
        symbols.forEach((symbol, i) => {
          const spec = parseNumeral(card.numerals[i]!);
          const a = analyzeChord(symbol, key);
          expect(a.root).toBe(degreePc(key, spec.degree, spec.accidental));
          expect(a.quality).toBe(spec.quality);
        });
      }
    }
  });

  it("realizes well-known cards to the expected chords", () => {
    expect(realizeCard(progressionById("jpop-oudou")!, "C major")).toEqual(["Fmaj7", "G7", "Em7", "Am"]);
    expect(realizeCard(progressionById("jpop-komuro")!, "C major")).toEqual(["Am", "F", "G", "C"]);
    expect(realizeCard(progressionById("jpop-marusa")!, "C major")).toEqual(["Fmaj7", "E7", "Am7", "C7"]);
    expect(realizeCard(progressionById("rock-andalusian")!, "A minor")).toEqual(["Am", "G", "F", "E"]);
    expect(realizeCard(progressionById("jazz-251-minor")!, "A minor")).toEqual(["Bm7b5", "E7", "Am"]);
    expect(realizeCard(progressionById("blues-12")!, "C major").slice(0, 5)).toEqual(["C7", "C7", "C7", "C7", "F7"]);
  });

  it("references only existing progression cards from genre cards", () => {
    for (const g of GENRES) {
      for (const id of g.progressions ?? []) expect(progressionById(id)).toBeDefined();
    }
  });

  it("finds cards by genre", () => {
    expect(cardsForGenre("jazz").length).toBeGreaterThanOrEqual(3);
    expect(cardsForGenre("blues").length).toBeGreaterThanOrEqual(2);
    expect(cardsForGenre("unknown")).toEqual([]);
  });
});
