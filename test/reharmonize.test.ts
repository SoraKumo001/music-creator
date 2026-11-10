import { describe, expect, it } from "vitest";
import { PlanSchema } from "../src/plan";
import { reharmonizePlan, substitutionsFor } from "../src/theory/reharmonize";

describe("substitutionsFor", () => {
  it("offers tonic-family alternatives for I", () => {
    expect(substitutionsFor("Cmaj7", "C major").map((s) => s.symbol)).toEqual(["Em7", "Am7"]);
  });

  it("offers IV for ii and ii for IV", () => {
    expect(substitutionsFor("Dm7", "C major").map((s) => s.symbol)).toEqual(["Fmaj7"]);
    expect(substitutionsFor("F", "C major").map((s) => s.symbol)).toEqual(["Dm"]);
  });

  it("offers viiø7 and the tritone sub for V7", () => {
    expect(substitutionsFor("G7", "C major").map((s) => s.symbol)).toEqual(["Bm7b5", "Db7"]);
  });

  it("offers III and VI for i in a minor key", () => {
    expect(substitutionsFor("Am", "A minor").map((s) => s.symbol)).toEqual(["C", "F"]);
  });

  it("has no suggestions for borrowed chords", () => {
    expect(substitutionsFor("Fm", "C major")).toEqual([]);
  });
});

describe("reharmonizePlan", () => {
  const plan = PlanSchema.parse({
    bpm: 100,
    key: "C major",
    chords: [[0, "Cmaj7"], [4, "Am7"], [8, "Dm7"], [12, "G7"], [16, "C"]],
  });

  it("suggests alternatives and keeps the final tonic", () => {
    const suggestions = reharmonizePlan(plan);
    expect(suggestions.map((s) => s.beat)).toEqual([0, 4, 8, 12]);
    expect(suggestions.find((s) => s.beat === 16)).toBeUndefined();
  });

  it("keeps the original numeral for context", () => {
    const first = reharmonizePlan(plan)[0]!;
    expect(first.numeral).toBe("Imaj7");
    expect(first.original).toBe("Cmaj7");
  });
});
