import { describe, expect, it } from "vitest";
import { corpusStyleFit, normalizedStyleScores } from "../src/knowledge/styleMatch";
import { corpusProfile } from "../src/knowledge/corpus";
import { BASS_STYLES, COMP_STYLES } from "../src/theory/accompaniment";

describe("corpusStyleFit", () => {
  it("is deterministic and covers every comp/bass style", () => {
    expect(corpusProfile).not.toBeNull();
    const a = corpusStyleFit(corpusProfile!);
    const b = corpusStyleFit(corpusProfile!);
    expect(a.comp).toEqual(b.comp);
    expect(a.bass).toEqual(b.bass);
    expect(Object.keys(a.comp).sort()).toEqual([...COMP_STYLES].sort());
    // none (無音) は対象外
    expect(Object.keys(a.bass).sort()).toEqual([...BASS_STYLES].filter((s) => s !== "none").sort());
    for (const v of [...Object.values(a.comp), ...Object.values(a.bass)]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a.bestPair.similarity).toBeGreaterThan(0);
  });

  it("normalizes scores into 0..1 with the best style at 1", () => {
    const fit = corpusStyleFit(corpusProfile!);
    const norm = normalizedStyleScores(fit.comp);
    expect(Math.max(...Object.values(norm))).toBeCloseTo(1, 6);
    expect(Math.min(...Object.values(norm))).toBeCloseTo(0, 6);
    expect(normalizedStyleScores({ a: 2, b: 2 })).toEqual({ a: 0, b: 0 });
  });
});
