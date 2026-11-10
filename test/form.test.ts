import { describe, expect, it } from "vitest";
import { PlanSchema } from "../src/plan";
import { normalizeForm } from "../src/theory/form";

const sections = (bars: number[], energy = 2) =>
  bars.map((b, i) => ({ name: String.fromCharCode(65 + i), bars: b, energy }));

describe("normalizeForm", () => {
  it("leaves a well-shaped song unchanged", () => {
    const plan = PlanSchema.parse({
      bpm: 120, chords: [[0, "C"]],
      sections: [{ name: "A", bars: 8, role: "verse" }, { name: "B", bars: 8, role: "chorus" }],
    });
    const { plan: out, merged } = normalizeForm(plan, 16);
    expect(merged).toBe(0);
    expect(out.sections.map((s) => s.bars)).toEqual([8, 8]);
  });

  it("merges chopped sections toward the corpus length", () => {
    // 2小節 × 10 = 20小節 → 6小節前後へ
    const plan = PlanSchema.parse({
      bpm: 120, chords: [[0, "C"]],
      sections: sections([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
    });
    const { plan: out, merged, sections: count } = normalizeForm(plan, 20, { targetBars: 6 });
    expect(merged).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
    const bars = out.sections.map((s) => s.bars);
    expect(bars.reduce((a, b) => a + b, 0)).toBe(20);
    // 併合後の平均が目標に近づく
    const avg = bars.reduce((a, b) => a + b, 0) / bars.length;
    expect(avg).toBeGreaterThan(3);
  });

  it("keeps the leading role and stronger energy when merging", () => {
    const plan = PlanSchema.parse({
      bpm: 120, chords: [[0, "C"]],
      sections: [
        { name: "I", bars: 2, role: "intro", energy: 1 },
        { name: "V", bars: 2, role: "verse", energy: 3 },
        { name: "C", bars: 2, role: "chorus", energy: 3 },
        { name: "O", bars: 2, role: "outro", energy: 1 },
        { name: "V2", bars: 2, role: "verse", energy: 2 },
        { name: "C2", bars: 2, role: "chorus", energy: 3 },
        { name: "X", bars: 2, role: "other", energy: 2 },
      ],
    });
    const { plan: out } = normalizeForm(plan, 14, { targetBars: 6 });
    // 役割は先頭優先で残る
    expect(out.sections[0]!.role).toBe("intro");
    // energy は強い方を採る
    expect(out.sections[0]!.energy).toBeGreaterThanOrEqual(1);
  });

  it("does not merge across a single long section", () => {
    const plan = PlanSchema.parse({ bpm: 120, chords: [[0, "C"]], sections: [{ name: "A", bars: 32 }] });
    const { plan: out, merged } = normalizeForm(plan, 32);
    expect(merged).toBe(0);
    expect(out.sections).toHaveLength(1);
  });
});
