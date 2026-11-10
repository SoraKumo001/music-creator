import { describe, expect, it } from "vitest";
import { evaluateDiversity } from "../src/eval/diversity";
import { PlanSchema } from "../src/plan";

const mk = (chords: [number, string][], extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({ bpm: 100, key: "C major", chords, ...extra });

describe("diversity", () => {
  it("rates identical progressions as non-diverse", () => {
    const plans = [0, 1, 2].map((i) => ({ name: `s${i}`, bars: 4, plan: mk([[0, "C"], [4, "G7"], [8, "C"]]) }));
    const s = evaluateDiversity(plans);
    expect(s.count).toBe(3);
    expect(s.distinctProgressionRate).toBeCloseTo(1 / 3);
    expect(s.keyVariety).toBeCloseTo(1 / 3);
  });

  it("rates varied progressions as diverse", () => {
    const plans = [
      { name: "a", bars: 4, plan: mk([[0, "C"], [4, "G7"], [8, "C"]]) },
      { name: "b", bars: 4, plan: mk([[0, "Am"], [4, "Dm"], [8, "E7"], [12, "Am"]], { key: "A minor", bpm: 120 }) },
      { name: "c", bars: 4, plan: mk([[0, "F"], [4, "C"], [8, "G"], [12, "C"]], { bpm: 90 }) },
    ];
    const s = evaluateDiversity(plans);
    expect(s.distinctProgressionRate).toBe(1);
    expect(s.cadenceVariety).toBeGreaterThanOrEqual(1);
    expect(s.bpmStddev).toBeGreaterThan(0);
  });
});
