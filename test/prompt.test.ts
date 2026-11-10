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
