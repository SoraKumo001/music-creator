import { describe, expect, it } from "vitest";
import { PlanSchema, resolveSections } from "../src/plan";
import { melodyMessages, planMessages } from "../src/prompt";

const system = (prompt: string) => planMessages(prompt, 8)[0]!.content;

describe("plan prompt", () => {
  it("injects genre-specific progression cards", () => {
    const text = system("ローファイな夜のBGM");
    expect(text).toContain("Progression vocabulary");
    expect(text).toContain("jazz-turnaround");
    expect(text).toContain("Imaj7–vi7–ii7–V7");
    expect(text).toContain("Example in C major");
  });

  it("falls back to seeded cards when no genre matches", () => {
    const a = system("静かな曲");
    const b = planMessages("静かな曲", 8, false, "band", { seed: 1 })[0]!.content;
    const c = planMessages("静かな曲", 8, false, "band", { seed: 2 })[0]!.content;
    expect(a).toContain("Progression vocabulary");
    // フォールバックは5枚サンプルされ、seedで変わる
    expect(b).toContain("Progression vocabulary");
    expect(b).not.toBe(c);
  });

  it("includes the harmony rules", () => {
    const text = system("ロック");
    expect(text).toContain("End each section with a cadence");
    expect(text).toContain("T -> S -> D -> T");
  });

  it("adds loop guidance when loop is requested", () => {
    const text = planMessages("ローファイ", 8, true)[0]!.content;
    expect(text).toContain("LOOPED");
    expect(text).toContain("turnaround");
    expect(text).not.toContain("End with a cadence that resolves to the tonic");
  });

  it("adds orchestral guidance when the orchestra is requested", () => {
    const text = planMessages("オーケストラ", 8, false, "orchestra")[0]!.content;
    expect(text).toContain("ORCHESTRAL");
  });

  it("varies key/tempo/progression by seed (same prompt does not produce the same plan)", () => {
    const a = planMessages("ローファイ", 8, false, "band", { seed: 1 })[0]!.content;
    const b = planMessages("ローファイ", 8, false, "band", { seed: 2 })[0]!.content;
    expect(a).toContain("Variation for this generation");
    expect(a).toContain("Tonic pitch class");
    expect(a).not.toBe(b);
    // 同じseedなら同じプロンプト (再現性)
    expect(a).toBe(planMessages("ローファイ", 8, false, "band", { seed: 1 })[0]!.content);
  });

  it("keeps the suggested tempo within the genre range", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const text = planMessages("ローファイ", 8, false, "band", { seed })[0]!.content;
      const m = /Tempo: about (\d+) BPM/.exec(text);
      expect(m).not.toBeNull();
      const bpm = Number(m![1]);
      expect(bpm).toBeGreaterThanOrEqual(70);
      expect(bpm).toBeLessThanOrEqual(90);
    }
  });

  it("rotates which genre progression cards are shown by seed", () => {
    const ids = ["jpop-6415", "rock-minor", "rock-145", "rock-andalusian", "pop-1564"];
    const shown = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const text = planMessages("ロック", 8, false, "band", { seed })[0]!.content;
      const present = ids.filter((id) => text.includes(`[${id}]`));
      expect(present.length).toBe(4); // 5枚中4枚
      shown.add(present.join(","));
    }
    // seedにより提示する組み合わせが変わる
    expect(shown.size).toBeGreaterThan(1);
  });

  it("does not add variation hints when no seed is provided", () => {
    expect(planMessages("ローファイ", 8)[0]!.content).not.toContain("Variation for this generation");
  });
});

describe("melody prompt", () => {
  it("adds loop guidance for looping songs", () => {
    const plan = PlanSchema.parse({ bpm: 100, key: "C major", loop: true, chords: [[0, "C"]] });
    const text = melodyMessages("x", plan, resolveSections(plan, 2, 4), 2, 4)[0]!.content;
    expect(text).toContain("The song will loop");
  });

  it("asks for a short final note otherwise", () => {
    const plan = PlanSchema.parse({ bpm: 100, key: "C major", chords: [[0, "C"]] });
    const text = melodyMessages("x", plan, resolveSections(plan, 2, 4), 2, 4)[0]!.content;
    expect(text).toContain("In the final bar, land on the tonic and stop");
  });

  it("asks for a violin melody in orchestra mode", () => {
    const plan = PlanSchema.parse({ bpm: 100, key: "C major", ensemble: "orchestra", chords: [[0, "C"]] });
    const text = melodyMessages("x", plan, resolveSections(plan, 2, 4), 2, 4)[0]!.content;
    expect(text).toContain("first violin");
  });
});
