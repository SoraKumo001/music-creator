import { describe, expect, it } from "vitest";
import { aggregateFeatures, drumName, type CorpusProfile } from "../src/analyze/corpus";
import { evaluateCorpusFit } from "../src/eval/corpusFit";
import type { MidiFeatures } from "../src/analyze/features";
import { applyCorpusHints, corpusProfile, corpusProfileForMode, corpusRuleHints, melodyTargets } from "../src/knowledge/corpus";
import { PlanSchema, resolveSections } from "../src/plan";
import { planMessages } from "../src/prompt";
import { assemble } from "../src/compose";
import { extractMidiLinks } from "../src/analyze/links";
import { drumPatternHitsPerBar } from "../src/theory/drums";
import type { Note } from "../src/score";

/** テスト用の最小フィーチャを作る */
function feature(overrides: Partial<MidiFeatures> = {}): MidiFeatures {
  return {
    name: "t",
    durationSec: 60,
    bpm: 128,
    bpmMin: 128,
    bpmMax: 128,
    timeSignature: [4, 4],
    bars: 32,
    barTicks: 480,
    barInference: "declared",
    barConfidence: 0,
    stepsPerBar: 16,
    key: "A minor",
    keyConfidence: 0.8,
    tracks: 1,
    channels: 6,
    noteCount: 1000,
    density: 16,
    polyphonyMean: 3,
    programs: { "33": 400, "38": 300, "81": 300 },
    drumHits: { "36": 100, "38": 100, "42": 200 },
    beatPos12: [0.25, 0.05, 0.05, 0.1, 0.05, 0.05, 0.15, 0.05, 0.05, 0.1, 0.05, 0.05],
    durations16: [0.4, 0.2, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0, 0, 0, 0, 0, 0, 0, 0],
    downbeatShare: 0.25,
    offbeat8thShare: 0.25,
    sixteenthShare: 0.45,
    offGridShare: 0.05,
    quantizationUnitBeats: 0.05,
    chordsPerBar: 1.5,
    chordQualities: { m7: 3, maj7: 2, "": 2, "7": 1 },
    romanBigrams: { "i7>VImaj7": 3, "VImaj7>iv7": 2, "iv7>V7": 2 },
    borrowedRate: 0.2,
    sectionBars: [8, 8, 8, 8],
    intervalHistogram: [0, 0.4, 0.2, 0.15, 0.05, 0.05, 0.05, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01],
    melodyRange: 24,
    melodyNotesPerBar: 6,
    offbeatRatio: 0.4,
    bass: {
      notesPerBar: 2,
      medianPitch: 40,
      motionHistogram: [0, 0.1, 0.1, 0.05, 0.05, 0.3, 0.1, 0.2, 0.02, 0.03, 0.02, 0.03],
      fifthShare: 0.5,
      stepShare: 0.2,
      leapShare: 0.05,
    },
    melody: { medianPitch: 72, stepwiseShare: 0.6, restRatio: 0.25, medianDuration16: 2 },
    susShare: 0.1,
    seventhShare: 0.4,
    familyStats: {
      bass: { notes: 400, notesPerBar: 1, medianPitch: 40 },
      lead: { notes: 300, notesPerBar: 2, medianPitch: 76 },
      pad: { notes: 300, notesPerBar: 2, medianPitch: 60 },
    },
    sectionStats: [
      { bars: 8, density: 20, drumTotal: 40, drumShares: { "36": 0.3, "38": 0.3, "42": 0.4 } },
      { bars: 8, density: 40, drumTotal: 80, drumShares: { "36": 0.25, "38": 0.25, "42": 0.5 } },
      { bars: 8, density: 70, drumTotal: 120, drumShares: { "36": 0.3, "38": 0.2, "42": 0.5 } },
      { bars: 8, density: 90, drumTotal: 160, drumShares: { "36": 0.2, "38": 0.3, "42": 0.5 } },
    ],
    drumFills: { barsWithDrums: 32, fillBars: 6, phraseEndBars: 8, phraseEndFills: 4 },
    ...overrides,
  };
}

describe("aggregateFeatures", () => {
  it("builds a profile from features", () => {
    const profile = aggregateFeatures([feature(), feature({ bpm: 140, key: "C major" })], { label: "test" });
    expect(profile.version).toBe(3);
    expect(profile.source.label).toBe("test");
    expect(profile.source.files).toBe(2);
    expect(profile.tempo.median).toBeGreaterThan(120);
    expect(profile.modeShare.major).toBeCloseTo(0.5);
    expect(profile.modeShare.minor).toBeCloseTo(0.5);
    expect(profile.instruments.synthLead).toBeGreaterThan(0);
    expect(profile.instruments.bass).toBeGreaterThan(0);
    expect(profile.drums["42"]).toBeGreaterThan(0.3);
    expect(profile.harmony.medianChordsPerBar).toBe(1.5);
    expect(profile.rhythm.sixteenthShare).toBeCloseTo(0.45);
    expect(profile.form.medianSectionBars).toBe(8);
    // v3: セクション密度別のドラム構成
    expect(profile.rhythm.drumHitsPerBar).toBeGreaterThan(0);
    expect(profile.drumByEnergy.low.sections).toBeGreaterThan(0);
    expect(profile.drumByEnergy.mid.sections).toBeGreaterThan(0);
    expect(profile.drumByEnergy.high.sections).toBeGreaterThan(0);
    expect(profile.drumByEnergy.low.medianHitsPerBar).toBeGreaterThan(0);
    expect(profile.insights.join(" ")).toContain("by section density");
    // セクション密度の弧: fixture は 20→90 と右肩上がり
    expect(profile.form.densityArc.risingShare).toBe(1);
    expect(profile.form.densityArc.medianPeakPosition).toBe(1);
    expect(profile.form.densityArc.medianFirstRatio).toBeLessThan(1.5);
    expect(profile.form.densityArc.medianLastRatio).toBeGreaterThan(1);
    expect(profile.insights.join(" ")).toContain("energy arc");
    // フィル統計
    expect(profile.rhythm.fillBarShare).toBeGreaterThan(0);
    expect(profile.rhythm.fillPhraseEndShare).toBeGreaterThan(0);
    expect(profile.rhythm.fillPhraseEndShare).toBeLessThanOrEqual(1);
    expect(profile.insights.join(" ")).toContain("Drum fills");
    // v2: ベース・旋律・楽器レジスタ・sus/7th の統計
    expect(profile.bass.medianNotesPerBar).toBeGreaterThan(0);
    expect(profile.bass.motionHistogram.length).toBe(12);
    expect(profile.harmony.susShare).toBeCloseTo(0.1, 3);
    expect(profile.harmony.seventhShare).toBeCloseTo(0.4, 3);
    expect(profile.melody.medianPitch).toBeGreaterThan(60);
    expect(profile.instrumentStats.bass?.share).toBeGreaterThan(0);
    expect(profile.insights.join(" ")).toContain("Bass:");
    expect(profile.insights.join(" ")).toContain("Melody:");
    expect(profile.insights.join(" ")).toContain("Typical registers");
    expect(profile.insights.length).toBeGreaterThan(3);
    // モードの知見は「短調が普通だから長調を既定にしない」と特定モードへ誘導しない
    expect(profile.insights.join(" ")).toContain("about equally");
    expect(profile.insights.join(" ")).toContain("do not default to minor");
  });

  it("flags a uniform tempo instead of pretending it is a style prior", () => {
    const profile = aggregateFeatures([feature(), feature()]);
    expect(profile.insights.join(" ")).toContain("uniform at");
    expect(profile.insights.join(" ")).not.toContain("Runaway");
  });

  it("names GM drums", () => {
    expect(drumName(36)).toBe("bassDrum");
    expect(drumName(42)).toBe("closedHat");
    expect(drumName(99)).toBe("drum99");
  });
});

describe("evaluateCorpusFit", () => {
  const profile: CorpusProfile = aggregateFeatures([feature(), feature({ key: "A minor" })]);
  const plan = PlanSchema.parse({
    bpm: 128, key: "A minor",
    chords: [[0, "Am7"], [8, "F"], [16, "Dm7"], [24, "E7"]],
    sections: [{ name: "A", bars: 4, role: "verse" }, { name: "B", bars: 4, role: "chorus" }],
  });
  const sections = resolveSections(plan, 8, 4);
  const score = assemble(plan, sections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], 8);

  it("scores a matching plan higher than a mismatching one", () => {
    const good = evaluateCorpusFit(plan, score, profile);
    const badPlan = PlanSchema.parse({
      bpm: 210, key: "C major",
      chords: [[0, "C"], [16, "G"]],
      sections: [{ name: "A", bars: 8, role: "other" }],
    });
    const badSections = resolveSections(badPlan, 8, 4);
    const badScore = assemble(badPlan, badSections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], 8);
    const bad = evaluateCorpusFit(badPlan, badScore, profile);
    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.total).toBeGreaterThan(50);
    expect(bad.notes.length).toBeGreaterThan(0);
  });

  it("is lenient for rich complexity", () => {
    const strict = evaluateCorpusFit(plan, score, profile, { complexity: "standard" });
    const rich = evaluateCorpusFit(plan, score, profile, { complexity: "rich" });
    expect(rich.parts.borrowed).toBeGreaterThanOrEqual(strict.parts.borrowed);
  });

  it("scores a corpus-like melody higher than a sparse one", () => {
    const wide: Note[] = Array.from({ length: 64 }, (_, i) => ({
      pitch: 65 + (i % 16),
      start: i * 0.5,
      duration: 0.45,
      velocity: 90,
    }));
    const sparse: Note[] = [{ pitch: 72, start: 0, duration: 3, velocity: 90 }];
    const wideFit = evaluateCorpusFit(plan, assemble(plan, sections, wide, 8), profile);
    const sparseFit = evaluateCorpusFit(plan, assemble(plan, sections, sparse, 8), profile);
    expect(wideFit.parts.melody).toBeGreaterThan(sparseFit.parts.melody);
    expect(wideFit.parts.melody).toBeGreaterThan(0.5);
  });
});

describe("generated profile", () => {
  it("is either absent or a well-formed profile", () => {
    if (corpusProfile === null) return;
    expect(corpusProfile.version).toBe(3);
    expect(corpusProfile.source.analyzed).toBeGreaterThan(0);
    expect(corpusProfile.insights.length).toBeGreaterThan(0);
    expect(corpusProfile.rhythm.beatPos16.length).toBeGreaterThan(0);
    // 旋律そのものは含まない ("notes per bar" のような統計の文言は可)
    const json = JSON.stringify(corpusProfile);
    expect(json).not.toMatch(/"pitches"\s*:/);
    expect(json).not.toMatch(/"notes"\s*:\s*\[/);
    expect(json).not.toMatch(/"startTicks"\s*:/);
  });

  it("injects corpus tendencies into the plan prompt only when a profile exists", () => {
    const system = planMessages("ロック", 8)[0]!.content;
    if (corpusProfile === null) {
      expect(system).not.toContain("Observed tendencies");
      return;
    }
    expect(system).toContain("Observed tendencies");
    expect(system).toContain("do not copy any specific piece");
    expect(system).toContain("You may deviate from these priors");
    // 旋律や具体的なコード列は注入しない
    expect(system).not.toContain("counter-melody");
  });

  it("can disable corpus injection for A/B measurement", () => {
    const off = planMessages("ロック", 8, false, "band", { corpus: false })[0]!.content;
    expect(off).not.toContain("Observed tendencies");
  });

  it("derives rule-layer hints from the profile", () => {
    const hints = corpusRuleHints();
    if (corpusProfile === null) {
      expect(hints).toBeNull();
      return;
    }
    expect(hints).not.toBeNull();
    expect(hints!.drumPatterns.length).toBeGreaterThan(3);
    expect(hints!.drumPatternsByEnergy[1].length).toBeGreaterThan(3);
    expect(hints!.drumPatternsByEnergy[2].length).toBeGreaterThan(3);
    expect(hints!.drumPatternsByEnergy[3].length).toBeGreaterThan(3);
    // 低密度セクションには高密度セクションより詰まったパターンを選ばない (上限のみ)
    const hitsPerBar = drumPatternHitsPerBar();
    expect(hitsPerBar[hints!.drumPatternsByEnergy[1][0]!] ?? 0).toBeLessThanOrEqual(
      (hitsPerBar[hints!.drumPatternsByEnergy[3][0]!] ?? 0) + 2,
    );
    expect(hints!.compStyles.length).toBeGreaterThan(3);
    expect(hints!.bassStyles.length).toBeGreaterThan(2);
    expect(hints!.programs.bass).toBe(33);
    expect(hints!.sectionBars).toBeGreaterThanOrEqual(2);
    // ドラムは構成比の近い順に並ぶ
    expect(typeof hints!.drumPatterns[0]).toBe("string");
  });

  it("picks drum patterns per section energy from the profile", () => {
    const hints = corpusRuleHints({ mode: "major" });
    if (!hints) return;
    const plan = PlanSchema.parse({
      bpm: 100,
      chords: [[0, "C"]],
      sections: [
        { name: "A", bars: 4, energy: 1, role: "intro" },
        { name: "B", bars: 4, energy: 2, role: "verse" },
        { name: "C", bars: 4, energy: 3, role: "chorus" },
      ],
    });
    const out = applyCorpusHints(plan);
    expect(out.sections[0]!.drums).toBe(hints.drumPatternsByEnergy[1][0]);
    expect(out.sections[1]!.drums).toBe(hints.drumPatternsByEnergy[2][1]);
    expect(out.sections[2]!.drums).toBe(hints.drumPatternsByEnergy[3][0]);
  });

  it("provides major/minor sub-profiles and keeps role-aware mode opt-in", () => {
    if (corpusProfile === null) return;
    const major = corpusProfileForMode("major");
    expect(major).not.toBeNull();
    // サブプロファイルが無ければ全体プロファイルへフォールバック
    if (major !== corpusProfile) {
      expect(major!.source.analyzed).toBeGreaterThan(0);
      expect(major!.modeShare.major).toBeGreaterThan(0.9);
    }
    expect(corpusRuleHints({ mode: "major" })).not.toBeNull();
    // roleAware は opt-in: 既定では intro でもコーパスの comp を使う
    const plan = PlanSchema.parse({
      bpm: 100,
      chords: [[0, "C"]],
      sections: [
        { name: "I", bars: 4, energy: 1, role: "intro" },
        { name: "C", bars: 4, energy: 3, role: "chorus" },
      ],
    });
    const hints = corpusRuleHints({ mode: "major" });
    if (!hints) return;
    expect(applyCorpusHints(plan).sections[0]!.comp).toBe(hints.compStyles[0]);
    expect(applyCorpusHints(plan, { roleAware: true }).sections[0]!.comp).toBe("pad");
  });

  it("derives melody scoring targets from the profile", () => {
    const targets = melodyTargets();
    if (!corpusProfile) {
      expect(targets).toBeUndefined();
      return;
    }
    expect(targets).not.toBeUndefined();
    expect(targets!.notesPerBar).toBeGreaterThan(0);
    expect(targets!.range).toBeGreaterThan(0);
    expect(targets!.medianPitch).toBeGreaterThan(50);
    expect(targets!.stepwiseShare).toBeGreaterThan(0);
    expect(targets!.range).toBe(corpusProfile.rhythm.medianMelodyRange);
  });

  it("applies hints only to fields left at schema defaults", () => {
    const hints = corpusRuleHints();
    if (!hints) return;
    const defaults = PlanSchema.parse({ bpm: 100, chords: [[0, "C"]] });
    const applied = applyCorpusHints(defaults);
    expect(applied.compProgram).toBe(hints.programs.comp);
    expect(applied.melodyProgram).toBe(hints.programs.melody);
    // セクションが無ければコーパス中央値の長さで1つ作る
    expect(applied.sections.length).toBe(1);
    expect(applied.sections[0]!.bars).toBe(hints.sectionBars);
    // 明示指定は尊重する
    const explicit = PlanSchema.parse({ bpm: 100, chords: [[0, "C"]], compProgram: 29, melodyProgram: 40, bassProgram: 34 });
    const kept = applyCorpusHints(explicit);
    expect(kept.compProgram).toBe(29);
    expect(kept.melodyProgram).toBe(40);
    expect(kept.bassProgram).toBe(34);
  });

  it("keeps styles the LLM chose explicitly", () => {
    if (!corpusRuleHints()) return;
    const plan = PlanSchema.parse({
      bpm: 100, chords: [[0, "C"]],
      sections: [
        { name: "A", bars: 4, comp: "strum", bass: "walking", drums: "rock" },
        { name: "B", bars: 4 }, // 既定値 (pad/root/basic) のセクション
      ],
    });
    const out = applyCorpusHints(plan);
    expect(out.sections[0]!.comp).toBe("strum");
    expect(out.sections[0]!.bass).toBe("walking");
    expect(out.sections[0]!.drums).toBe("rock");
    expect(out.sections[1]!.comp).not.toBe("pad");
  });

  it("selects the comp instrument by genre", () => {
    const p = corpusProfile;
    if (!p) return;
    // ピアノ/クラシックは鍵盤、ロックはギター、既定はコーパス上位 (リード系)
    if ((p.instruments.piano ?? 0) >= 0.02) {
      const h = corpusRuleHints({ prompt: "静かなクラシックのピアノ曲" })!;
      expect(h.programs.comp).toBe(0);
      expect(h.programs.melody).toBe(0);
    }
    if ((p.instruments.guitar ?? 0) >= 0.02) {
      const h = corpusRuleHints({ prompt: "疾走感のあるロック" })!;
      expect(h.programs.comp).toBe(29);
      expect(h.programs.melody).toBe(29);
    }
    const dflt = corpusRuleHints();
    expect(dflt!.programs.comp).toBe(dflt!.programs.comp); // 破綻しないこと
  });

  it("does not touch orchestra plans beyond programs", () => {
    if (!corpusRuleHints()) return;
    const plan = PlanSchema.parse({
      bpm: 100, chords: [[0, "C"]], ensemble: "orchestra",
      sections: [{ name: "A", bars: 4 }],
    });
    const out = applyCorpusHints(plan);
    expect(out.sections[0]!.comp).toBe("pad");
    expect(out.sections[0]!.drums).toBe("basic");
  });
});

describe("extractMidiLinks", () => {
  it("resolves relative links and dedupes", () => {
    const html = '<a href="./kit/mid/a.mid">a</a><a href="./kit/mid/b.mid">b</a><a href="./kit/mid/a.mid">dup</a>';
    const links = extractMidiLinks(html, "https://example.com/labo/midi.html");
    expect(links).toEqual([
      "https://example.com/labo/kit/mid/a.mid",
      "https://example.com/labo/kit/mid/b.mid",
    ]);
  });

  it("ignores broken and non-midi links", () => {
    const html = '<a href="/x.mid">x</a><a href="page.html">p</a><a href="http://[bad">bad</a>';
    const links = extractMidiLinks(html, "https://example.com/");
    expect(links).toEqual(["https://example.com/x.mid"]);
  });
});


