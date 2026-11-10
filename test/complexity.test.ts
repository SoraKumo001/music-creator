import { describe, expect, it } from "vitest";
import { evaluateComplexity } from "../src/eval/complexity";
import { PlanSchema } from "../src/plan";

describe("complexity", () => {
  it("scores a simple plan lower than a rich one", () => {
    const simple = {
      name: "simple", bars: 4,
      plan: PlanSchema.parse({ bpm: 100, key: "C major", chords: [[0, "C"], [4, "G7"], [8, "C"]] }),
    };
    const rich = {
      name: "rich", bars: 8,
      plan: PlanSchema.parse({
        bpm: 120, key: "C major",
        keyChanges: [{ bar: 4, key: "G major" }],
        chords: [[0, "C"], [4, "Am7"], [8, "Dm7"], [12, "G7"], [16, "G"], [20, "Em7"], [24, "Am7"], [28, "D7"]],
        sections: [
          { name: "A", bars: 4, role: "verse" },
          { name: "B", bars: 4, role: "chorus", swell: 1 },
        ],
      }),
    };
    const s = evaluateComplexity([simple]);
    const r = evaluateComplexity([rich]);
    expect(r.score100).toBeGreaterThan(s.score100);
    expect(r.modulationRate).toBe(1);
    expect(s.modulationRate).toBe(0);
    expect(r.avgSections).toBe(2);
  });
});
