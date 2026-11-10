import { describe, expect, it } from "vitest";
import { PlanSchema } from "../src/plan";
import {
  checkCommonProgression,
  isCommonSkeleton,
  requestNamesProgression,
  sectionSkeleton,
} from "../src/theory/progression-shape";

const plan = (chords: [number, string][], extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({ bpm: 120, key: "C major", chords, ...extra });

describe("isCommonSkeleton", () => {
  it("detects the canonical loops including rotations", () => {
    expect(isCommonSkeleton(["I", "V", "vi", "IV"])).toBe(true);
    expect(isCommonSkeleton(["V", "vi", "IV", "I"])).toBe(true); // 循環一致
    expect(isCommonSkeleton(["IV", "V", "iii", "vi"])).toBe(true); // 王道
    expect(isCommonSkeleton(["vi", "IV", "I", "V"])).toBe(true);
    expect(isCommonSkeleton(["I", "vi", "ii", "V"])).toBe(true);
  });

  it("accepts non-canonical progressions", () => {
    expect(isCommonSkeleton(["I", "IV", "ii", "V"])).toBe(false);
    expect(isCommonSkeleton(["i", "VI", "III", "VII"])).toBe(false);
    expect(isCommonSkeleton(["IV", "iii", "ii", "I"])).toBe(false);
    expect(isCommonSkeleton([])).toBe(false);
  });
});

describe("sectionSkeleton", () => {
  it("extracts the first section's degrees and collapses repeats", () => {
    const p = plan(
      [[0, "C"], [4, "G"], [8, "Am"], [12, "F"], [16, "C"], [20, "G"]],
      { sections: [{ name: "A", bars: 4, energy: 2 }, { name: "B", bars: 2, energy: 3 }] },
    );
    expect(sectionSkeleton(p, 6)).toEqual(["I", "V", "vi", "IV"]);
  });

  it("returns [] when a secondary dominant makes the shape ambiguous", () => {
    const p = plan([[0, "C"], [4, "A7"], [8, "D"], [12, "G"]]);
    expect(sectionSkeleton(p, 4)).toEqual([]);
  });
});

describe("checkCommonProgression", () => {
  it("flags 1564 as common", () => {
    const p = plan([[0, "C"], [4, "G"], [8, "Am"], [12, "F"]]);
    const v = checkCommonProgression(p, 4, "明るいポップ");
    expect(v.skeleton).toEqual(["I", "V", "vi", "IV"]);
    expect(v.common).toBe(true);
  });

  it("allows the canonical progression when the request names it", () => {
    const p = plan([[0, "C"], [4, "G"], [8, "Am"], [12, "F"]]);
    expect(requestNamesProgression("王道進行でお願いします")).toBe(true);
    expect(checkCommonProgression(p, 4, "王道進行でお願いします").common).toBe(false);
    expect(checkCommonProgression(p, 4, "おまかせ").common).toBe(true);
  });

  it("does not flag a varied progression", () => {
    const p = plan([[0, "C"], [4, "F"], [8, "Dm"], [12, "G"]]); // I–IV–ii–V
    expect(checkCommonProgression(p, 4, "ポップ").common).toBe(false);
  });
});

