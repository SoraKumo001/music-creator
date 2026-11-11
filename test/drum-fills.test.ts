import { describe, expect, it } from "vitest";
import { generateDrums, drumFillStats } from "../src/theory/drums";
import { resolveSections } from "../src/plan";
import { PlanSchema } from "../src/plan";

const sectionsOf = () =>
  resolveSections(
    PlanSchema.parse({
      bpm: 125,
      chords: [[0, "C"]],
      sections: [
        { name: "A", bars: 4, energy: 2, role: "verse" },
        { name: "B", bars: 4, energy: 3, role: "chorus" },
        { name: "C", bars: 4, energy: 2, role: "verse" },
        { name: "D", bars: 4, energy: 3, role: "chorus" },
      ],
    }),
    16,
    4,
  );

describe("drum fills", () => {
  it("detects tom/snare fill bars", () => {
    const stats = drumFillStats(
      [
        // 通常小節 (ドラムなし扱いの小節は数えない)
        { pitch: 36, start: 0 },
        { pitch: 42, start: 0.5 },
        // フィル小節: トム2打
        { pitch: 45, start: 4 },
        { pitch: 48, start: 4.5 },
        // フィル小節: スネア連打
        ...Array.from({ length: 6 }, (_, i) => ({ pitch: 38, start: 8 + i * 0.25 })),
      ],
      4,
      4,
    );
    expect(stats.barsWithDrums).toBe(3);
    expect(stats.fillBars).toBe(2);
  });

  it("thins section-end fills when a corpus fill rate is given", () => {
    const sections = sectionsOf();
    const noRate = generateDrums(sections, 4, "button", false, { seed: 7 });
    const sparse = generateDrums(sections, 4, "button", false, { seed: 7, fillRate: 0.01 });
    const dense = generateDrums(sections, 4, "button", false, { seed: 7, fillRate: 0.6 });
    const fillBars = (notes: { pitch: number; start: number }[]) => drumFillStats(notes, 16, 4).fillBars;
    expect(fillBars(dense)).toBeGreaterThan(fillBars(sparse));
    // 既定 (fillRate 未指定) は従来どおり全セクション末尾にフィル
    expect(fillBars(noRate)).toBeGreaterThanOrEqual(fillBars(sparse));
  });
});
