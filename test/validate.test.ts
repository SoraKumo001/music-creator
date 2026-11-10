import { describe, expect, it } from "vitest";
import { PlanSchema } from "../src/plan";
import { repairPlan } from "../src/theory/repair";
import { validatePlan, type Issue } from "../src/theory/validate";

const mk = (chords: [number, string][], extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({ bpm: 100, key: "C major", chords, ...extra });

const codes = (issues: Issue[]) => issues.map((i) => i.code);
const has = (issues: Issue[], code: string) => issues.some((i) => i.code === code);

describe("validatePlan", () => {
  it("accepts a well-formed progression", () => {
    const plan = mk([[0, "Cmaj7"], [8, "Am7"], [16, "Dm7"], [24, "G7"], [28, "C"]]);
    const issues = validatePlan(plan, 8);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(has(issues, "NO_CADENCE")).toBe(false);
    expect(has(issues, "WEAK_ENDING")).toBe(false);
    expect(has(issues, "RETROGRESSION")).toBe(false);
  });

  it("flags D -> S retrogression", () => {
    const plan = mk([[0, "C"], [4, "G7"], [8, "F"], [12, "C"]]);
    const issues = validatePlan(plan, 4);
    const retro = issues.find((i) => i.code === "RETROGRESSION");
    expect(retro?.beat).toBe(8);
  });

  it("flags a missing tonic", () => {
    const plan = mk([[0, "Dm7"], [8, "G7"], [16, "Am7"], [24, "F"]]);
    expect(has(validatePlan(plan, 8), "NO_TONIC")).toBe(true);
  });

  it("flags a key mismatch as an error", () => {
    const plan = mk([[0, "F#maj7"], [8, "G#m7"], [16, "A#m7"], [24, "D#m7"]]);
    const issues = validatePlan(plan, 8);
    expect(issues.find((i) => i.code === "KEY_MISMATCH")?.severity).toBe("error");
  });

  it("flags a weak ending and missing cadence", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "G"]]);
    const issues = validatePlan(plan, 8);
    expect(has(issues, "WEAK_ENDING")).toBe(true);
  });

  it("flags off-grid chords", () => {
    const plan = mk([[0, "C"], [1.5, "F"], [4, "G7"], [8, "C"]]);
    expect(has(validatePlan(plan, 4), "HARMONIC_RHYTHM")).toBe(true);
  });

  it("flags too many and too few chords", () => {
    const many = mk(["C", "Dm", "Em", "F", "G", "Am", "Bdim", "C", "G7"].map((s, i) => [i, s] as [number, string]));
    expect(has(validatePlan(many, 4), "TOO_MANY_CHORDS")).toBe(true);
    const few = mk([[0, "C"]]);
    expect(has(validatePlan(few, 8), "TOO_FEW_CHORDS")).toBe(true);
  });

  it("flags a section boundary without a dominant", () => {
    const plan = mk(
      [[0, "C"], [8, "F"], [16, "G7"], [24, "C"], [28, "F"]],
      { sections: [{ name: "A", bars: 4 }, { name: "B", bars: 4 }] },
    );
    const issues = validatePlan(plan, 8);
    const boundary = issues.find((i) => i.code === "SECTION_CADENCE");
    expect(boundary?.beat).toBe(16);
  });

  it("records unexplained chromatic chords as info", () => {
    const plan = mk([[0, "C"], [8, "F#m"], [16, "G7"], [24, "C"]]);
    const issue = validatePlan(plan, 8).find((i) => i.code === "CHROMATIC_UNEXPLAINED");
    expect(issue?.severity).toBe("info");
  });

  it("checks the loop lead-in instead of the final cadence", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "G7"]], { loop: true });
    const issues = validatePlan(plan, 8);
    expect(has(issues, "NO_CADENCE")).toBe(false);
    expect(has(issues, "WEAK_ENDING")).toBe(false);
    expect(has(issues, "LOOP_LEAD_IN")).toBe(false);
    expect(has(issues, "LOOP_TARGET")).toBe(false);
  });

  it("flags a loop whose last chord does not lead back", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "F"]], { loop: true });
    expect(has(validatePlan(plan, 8), "LOOP_LEAD_IN")).toBe(true);
  });

  it("flags a loop that does not start on the tonic", () => {
    const plan = mk([[0, "Am"], [8, "Dm"], [16, "G7"], [24, "G7"]], { loop: true });
    expect(has(validatePlan(plan, 8), "LOOP_TARGET")).toBe(true);
  });
});

describe("repairPlan", () => {
  it("leaves a good progression unchanged", () => {
    const plan = mk([[0, "Cmaj7"], [8, "Am7"], [16, "Dm7"], [24, "G7"], [28, "C"]]);
    const { plan: repaired, fixes } = repairPlan(plan, 8);
    expect(fixes).toEqual([]);
    expect(repaired.chords).toEqual(plan.chords);
  });

  it("ends on the tonic and closes with V-I", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "G"]]);
    const { plan: repaired, fixes } = repairPlan(plan, 8);
    expect(repaired.chords.at(-1)![1]).toBe("C");
    expect(repaired.chords.at(-2)![1]).toBe("G7");
    expect(codes(fixes)).toEqual(expect.arrayContaining(["WEAK_ENDING", "NO_CADENCE"]));
    const after = validatePlan(repaired, 8);
    expect(after.filter((i) => i.severity === "error")).toEqual([]);
    expect(has(after, "WEAK_ENDING")).toBe(false);
    expect(has(after, "NO_CADENCE")).toBe(false);
  });

  it("moves a late first chord to beat 0", () => {
    const plan = mk([[4, "C"], [8, "G7"], [12, "C"]]);
    const { plan: repaired } = repairPlan(plan, 4);
    expect(repaired.chords[0]![0]).toBe(0);
  });

  it("snaps chords to the beat grid and drops duplicates", () => {
    const plan = mk([[0, "C"], [0.4, "Dm"], [4, "G7"], [8, "C"]]);
    const { plan: repaired } = repairPlan(plan, 4);
    expect(repaired.chords).toEqual([[0, "C"], [4, "G7"], [8, "C"]]);
  });

  it("swaps a retrogression pair", () => {
    const plan = mk([[0, "C"], [4, "G7"], [8, "F"], [12, "C"]]);
    const { plan: repaired, fixes } = repairPlan(plan, 4);
    expect(repaired.chords.map(([, s]) => s)).toEqual(["C", "F", "G7", "C"]);
    expect(has(fixes, "RETROGRESSION")).toBe(true);
  });

  it("adds the tonic when the progression has none", () => {
    const plan = mk([[0, "Dm7"], [8, "G7"], [16, "Am7"], [24, "F"]]);
    const { plan: repaired } = repairPlan(plan, 8);
    expect(repaired.chords[0]![1]).toBe("C");
  });

  it("puts a dominant before a section boundary", () => {
    const plan = mk([[0, "C"], [4, "F"], [8, "G7"], [12, "C"]], {
      sections: [{ name: "A", bars: 2 }, { name: "B", bars: 2 }],
    });
    const { plan: repaired, fixes } = repairPlan(plan, 4);
    expect(repaired.chords.find(([beat]) => beat === 4)![1]).toBe("G7");
    expect(has(fixes, "SECTION_CADENCE")).toBe(true);
    expect(has(validatePlan(repaired, 4), "SECTION_CADENCE")).toBe(false);
  });

  it("turns the last chord into a dominant in loop mode", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "F"]], { loop: true });
    const { plan: repaired, fixes } = repairPlan(plan, 8);
    expect(repaired.chords.at(-1)![1]).toBe("G7");
    expect(has(fixes, "LOOP_LEAD_IN")).toBe(true);
  });

  it("keeps a tonic or dominant ending in loop mode", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "Dm"], [24, "C"]], { loop: true });
    const { plan: repaired, fixes } = repairPlan(plan, 8);
    expect(repaired.chords.at(-1)![1]).toBe("C");
    expect(has(fixes, "WEAK_ENDING")).toBe(false);
    expect(has(fixes, "NO_CADENCE")).toBe(false);
  });
});
