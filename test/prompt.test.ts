import { describe, expect, it } from "vitest";
import { PlanSchema, resolveSections } from "../src/plan";
import { pickGenreCards } from "../src/knowledge/genres";
import { PROGRESSIONS, progressionById } from "../src/knowledge/progressions";
import { melodyMessages, pickMode, planMessages } from "../src/prompt";

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
    expect(a).toContain("Key: use exactly");
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

  it("shows only progression cards that match the generation mode", () => {
    // ロックのジャンルカードが参照する進行カード
    const cards = pickGenreCards("ロック").flatMap((g) =>
      (g.progressions ?? []).flatMap((id) => {
        const card = progressionById(id);
        return card ? [card] : [];
      }),
    );
    const majorSets = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      const text = planMessages("明るいロック", 8, false, "band", { seed })[0]!.content;
      const shown = cards.filter((c) => text.includes(`[${c.id}]`));
      expect(shown.length).toBeGreaterThan(0);
      for (const c of shown) expect(c.mode).toBe("major");
      // プロンプト内の提示順 (seed でシャッフルされる)
      const order = [...shown]
        .sort((a, b) => text.indexOf(`[${a.id}]`) - text.indexOf(`[${b.id}]`))
        .map((c) => c.id)
        .join(",");
      majorSets.add(order);
    }
    // 同じモードでも seed により提示順・組み合わせが変わる
    expect(majorSets.size).toBeGreaterThan(1);
    // 短調指定なら短調カードだけになる
    const minorText = planMessages("暗いロック", 8, false, "band", { seed: 3 })[0]!.content;
    const minorShown = cards.filter((c) => minorText.includes(`[${c.id}]`));
    expect(minorShown.length).toBeGreaterThanOrEqual(2);
    for (const c of minorShown) expect(c.mode).toBe("minor");
  });

  it("tops up with same-mode cards when the genre has too few", () => {
    // ファンクの進行カードは長調ばかり。短調指定なら全体から短調カードで補う
    const text = planMessages("暗いファンク", 8, false, "band", { seed: 2 })[0]!.content;
    const shown = PROGRESSIONS.filter((c) => text.includes(`[${c.id}]`));
    expect(shown.length).toBeGreaterThan(0);
    const genreIds = new Set(pickGenreCards("暗いファンク").flatMap((g) => g.progressions ?? []));
    // ジャンル外のカードで補われたものはすべて短調
    for (const c of shown.filter((x) => !genreIds.has(x.id))) expect(c.mode).toBe("minor");
  });

  it("does not add variation hints when no seed is provided", () => {
    expect(planMessages("ローファイ", 8)[0]!.content).not.toContain("Variation for this generation");
  });

  it("decides the mode deterministically from the request and the corpus prior", () => {
    // 雰囲気を名指ししていればそれに従う
    expect(pickMode("明るいゲーム音楽", 1)).toBe("major");
    expect(pickMode("勇ましいバトル", 1)).toBe("major");
    expect(pickMode("暗いバトル", 1)).toBe("minor");
    expect(pickMode("悲しいピアノ曲", 1)).toBe("minor");
    expect(pickMode("短調のバラード", 1)).toBe("minor");
    // モードの明示指定は雰囲気語より優先する
    expect(pickMode("長調で悲しい曲", 1)).toBe("major");
    expect(pickMode("明るい短調の曲", 1)).toBe("minor");
    expect(pickMode("MUST be a minor key, happy melody", 1)).toBe("minor");
    expect(pickMode("use a major key, dark atmosphere", 1)).toBe("major");
    // 英語は単語境界で判定する ("Enjoy" の joy、"minority" の minor を拾わない)
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(pickMode("Enjoy the game", seed)).toBe(pickMode("just a game", seed));
    }
    expect(pickMode("minority report", 1)).toBe(pickMode("report", 1));
    // 英語の派生形 (darker / sadness / brighter) も雰囲気として拾う
    expect(pickMode("darker battle theme", 1)).toBe("minor");
    expect(pickMode("sadness and rain", 1)).toBe("minor");
    expect(pickMode("brighter melody", 1)).toBe("major");
    expect(pickMode("happiness", 1)).toBe("major");
    // 名指しが無ければコーパス比率 (ほぼ半々) を seed で引く。同じ seed なら再現する
    expect(pickMode("ゲームのボス戦BGM", 7)).toBe(pickMode("ゲームのボス戦BGM", 7));
    const modes = new Set(Array.from({ length: 64 }, (_, i) => pickMode("ゲームのボス戦BGM", i + 1)));
    expect(modes.size).toBe(2);
    // コーパス比率を切ると 50/50 で引く (A/B計測用)
    const abModes = new Set(
      Array.from({ length: 64 }, (_, i) => pickMode("ゲームのボス戦BGM", i + 1, { corpusPrior: false })),
    );
    expect(abModes.size).toBe(2);
  });

  it("states the chosen key and mode in the variation block", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const text = planMessages("ゲームのボス戦BGM", 8, false, "band", { seed })[0]!.content;
      const m = /Key: use exactly [A-G][#b]? (major|minor)/.exec(text);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(pickMode("ゲームのボス戦BGM", seed));
      expect(text).toMatch(/switch to the (major|minor) mode/);
    }
    // 明るいリクエストは長調に固定される
    const bright = planMessages("明るく元気なアニメソング", 8, false, "band", { seed: 3 })[0]!.content;
    expect(bright).toMatch(/Key: use exactly [A-G][#b]? major/);
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
