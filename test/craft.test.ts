import { describe, expect, it } from "vitest";
import { PlanSchema, resolveSections, type Plan } from "../src/plan";
import { evaluateCraft } from "../src/theory/craft";

const mk = (chords: [number, string][], extra: Record<string, unknown> = {}): Plan =>
  PlanSchema.parse({
    bpm: 120,
    key: "C major",
    chords,
    sections: [
      { name: "A", bars: 4, role: "verse", energy: 2 },
      { name: "B", bars: 4, role: "chorus", energy: 3 },
    ],
    ...extra,
  });

const report = (plan: Plan, bars = 8) => evaluateCraft(plan, resolveSections(plan, bars, 4), bars);

describe("evaluateCraft", () => {
  it("scores a well-formed plan high", () => {
    const r = report(
      mk([
        [0, "C"],
        [8, "Am"],
        [16, "Dm"],
        [24, "G7"],
        [28, "C"],
      ]),
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.failed).not.toContain("tonicEarly");
    expect(r.failed).not.toContain("tonicClosure");
    expect(r.failed).not.toContain("harmonicRhythm");
    expect(r.checks.map((c) => c.id)).toEqual([
      "tonicEarly",
      "cadenceBeforeLastSection",
      "tonicClosure",
      "sectionContrast",
      "thematicReturn",
      "harmonicRhythm",
    ]);
  });

  it("flags a late tonic", () => {
    const r = report(
      mk([
        [0, "Am"],
        [8, "F"],
        [16, "G"],
        [24, "C"],
        [28, "C"],
      ]),
    );
    expect(r.failed).toContain("tonicEarly");
    const check = r.checks.find((c) => c.id === "tonicEarly")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("no tonic");
  });

  it("flags weak closure and missing cadence before the last section", () => {
    const r = report(
      mk([
        [0, "C"],
        [8, "Am"],
        [16, "F"],
        [20, "Dm"],
        [24, "Am"],
        [28, "Am"],
      ]),
    );
    expect(r.failed).toContain("tonicClosure");
    expect(r.failed).toContain("cadenceBeforeLastSection");
  });

  it("flags a lack of section contrast", () => {
    const plan = PlanSchema.parse({
      bpm: 120,
      key: "C major",
      chords: [
        [0, "C"],
        [8, "F"],
        [16, "G"],
        [24, "C"],
      ],
      sections: [
        { name: "A", bars: 4, role: "verse", energy: 2, comp: "pad", bass: "root", drums: "basic" },
        { name: "B", bars: 4, role: "chorus", energy: 2, comp: "pad", bass: "root", drums: "basic" },
      ],
    });
    expect(report(plan).failed).toContain("sectionContrast");
  });

  it("checks thematic return only for 16+ bar songs", () => {
    const plan = PlanSchema.parse({
      bpm: 120,
      key: "C major",
      chords: [
        [0, "C"],
        [8, "F"],
        [16, "G"],
        [24, "C"],
        [32, "C"],
        [40, "F"],
        [48, "G"],
        [56, "C"],
      ],
      sections: [
        { name: "A", bars: 4, role: "verse", energy: 2 },
        { name: "B", bars: 4, role: "bridge", energy: 2 },
        { name: "C", bars: 4, role: "other", energy: 2 },
        { name: "D", bars: 4, role: "other", energy: 3 },
      ],
    });
    const r = report(plan, 16);
    // verse が1回しか出てこないので失敗
    expect(r.failed).toContain("thematicReturn");
    // 8小節版では n/a で成功扱い
    const short = report(shake(plan), 8);
    expect(short.failed).not.toContain("thematicReturn");
  });

  it("flags an over-dense harmonic rhythm", () => {
    const chords: [number, string][] = [];
    for (let i = 0; i < 24; i++) chords.push([i, i % 2 === 0 ? "C" : "G"]);
    const r = report(mk(chords));
    expect(r.failed).toContain("harmonicRhythm");
  });
});

/** 小節数に収まるよう chords を縮めたプラン (8小節版のテスト用) */
function shake(plan: Plan): Plan {
  return { ...plan, chords: plan.chords.filter(([beat]) => beat < 32) };
}
