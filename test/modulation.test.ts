import { describe, expect, it } from "vitest";
import { closelyRelatedKeys, pivotChords, suggestModulation } from "../src/theory/modulation";

describe("pivotChords", () => {
  it("finds the shared triads between C major and G major", () => {
    const symbols = pivotChords("C major", "G major").map((p) => p.symbol).sort();
    expect(symbols).toEqual(["Am", "C", "Em", "G"]);
  });

  it("finds all seven triads between C major and its relative minor", () => {
    expect(pivotChords("C major", "A minor")).toHaveLength(7);
  });

  it("works between minor keys", () => {
    const symbols = pivotChords("A minor", "E minor").map((p) => p.symbol);
    expect(symbols).toContain("Em");
    expect(symbols).toContain("Am");
  });
});

describe("closelyRelatedKeys", () => {
  it("lists the dominant, subdominant, relative and parallel keys", () => {
    const relations = closelyRelatedKeys("C major");
    expect(relations.find((r) => r.relation === "dominant")!.key).toEqual({ root: 7, mode: "major" });
    expect(relations.find((r) => r.relation === "subdominant")!.key).toEqual({ root: 5, mode: "major" });
    expect(relations.find((r) => r.relation === "relative minor")!.key).toEqual({ root: 9, mode: "minor" });
    expect(relations.find((r) => r.relation === "parallel minor")!.key).toEqual({ root: 0, mode: "minor" });
  });
});

describe("suggestModulation", () => {
  it("recommends a predominant pivot into the new key", () => {
    const suggestion = suggestModulation("C major", "G major");
    expect(suggestion.recommended?.symbol).toBe("Am");
    expect(suggestion.recommended?.toNumeral).toBe("ii");
    expect(suggestion.approach).toContain("Pivot on Am");
  });

  it("falls back when there is no shared triad", () => {
    const suggestion = suggestModulation("C major", "F# major");
    expect(suggestion.pivots.length).toBeLessThanOrEqual(1);
  });
});
