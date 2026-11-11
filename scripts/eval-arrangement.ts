/**
 * 編曲だけのオフライン・コーパス適合度評価 (LLMなし・決定的)。
 * 保存済みのプラン・フィクスチャから伴奏を組み立て、参照コーパスの統計への近さを測る。
 * 「解析 → 生成 → 測定 → 改善」ループを LLM コストなしで回すための補助 CLI。
 *
 *   npm run eval:arrangement
 *
 * 16小節に拡張したフィクスチャを複数 seed で回し、複数の和声化設定を比較する。
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyCorpusHints, corpusProfile } from "../src/knowledge/corpus";
import { evaluateCorpusFit } from "../src/eval/corpusFit";
import { PlanSchema, resolveSections } from "../src/plan";
import { assemble } from "../src/compose";
import { colorPlan } from "../src/theory/color";
import { parseChord } from "../src/theory/harmony";
import type { Note } from "../src/score";

type Fixture = { name: string; bars: number; plan: { chords: [number, string][] } & Record<string, unknown> };

const dir = "test/fixtures/plans";
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const SEEDS = [1, 2, 3, 4];

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 決定的な旋律 (コードトーンを8分で回すだけ。評価対象は伴奏とリズム) */
function melodyFor(plan: ReturnType<typeof PlanSchema.parse>, bars: number): Note[] {
  const chords = plan.chords.map(([start, symbol]) => {
    const chord = parseChord(symbol);
    return { start, root: chord.root, tones: chord.tones.length > 0 ? chord.tones : [chord.root, chord.root + 4, chord.root + 7] };
  });
  const notes: Note[] = [];
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const totalBeats = bars * beatsPerBar;
  let chordIndex = 0;
  for (let beat = 0; beat < totalBeats; beat += 0.5) {
    while (chordIndex + 1 < chords.length && chords[chordIndex + 1]!.start <= beat) chordIndex++;
    const c = chords[chordIndex]!;
    const tone = c.tones[Math.round(beat * 2) % c.tones.length]!;
    notes.push({ pitch: 72 + (tone % 12), start: beat, duration: 0.45, velocity: 90 });
  }
  return notes;
}

if (!corpusProfile) throw new Error("corpus profile is missing");
const corpusSus = Math.max(0.05, Math.min(0.5, corpusProfile.harmony.susShare));

type Variant = { name: string; susProbability: number; useStyleFit: boolean; useDrumDensityFit: boolean; roleAware: boolean; modeProfiles: boolean };
const VARIANTS: Variant[] = [
  // 既定 (コーパス忠実度優先): role-aware は opt-in
  { name: "corpusDefault", susProbability: corpusSus, useStyleFit: true, useDrumDensityFit: true, roleAware: false, modeProfiles: true },
  { name: "noModeProfiles", susProbability: corpusSus, useStyleFit: true, useDrumDensityFit: true, roleAware: false, modeProfiles: false },
  { name: "roleAware", susProbability: corpusSus, useStyleFit: true, useDrumDensityFit: true, roleAware: true, modeProfiles: true },
  { name: "noDrumDensity", susProbability: corpusSus, useStyleFit: true, useDrumDensityFit: false, roleAware: false, modeProfiles: true },
  { name: "legacySus", susProbability: 0.35, useStyleFit: true, useDrumDensityFit: true, roleAware: false, modeProfiles: true },
  { name: "noStyleFit", susProbability: corpusSus, useStyleFit: false, useDrumDensityFit: true, roleAware: false, modeProfiles: true },
];

type Row = {
  name: string;
  variant: string;
  seed: number;
  total: number;
  parts: Record<string, number>;
  comp: string;
  bass: string;
  drums: string;
};

const rows: Row[] = [];
for (const file of files) {
  const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
  // 16小節へ拡張 (和声化の機会を増やし、色付けの差が出るようにする)
  const sourceChords = fixture.plan.chords;
  const spanBeats = fixture.bars * 4;
  const chords: [number, string][] = [
    ...sourceChords,
    ...sourceChords.map(([b, s]) => [b + spanBeats, s] as [number, string]),
  ];
  const bars = fixture.bars * 2;
  // 16小節を 4小節×4セクションに分け、energy 1/2/3 と intro/verse/chorus を混在させる
  // (コーパス側の「セクションエネルギー別ドラム」を評価に反映するため)
  const sections = [
    { name: "Intro", bars: 4, energy: 1, role: "intro" },
    { name: "Verse", bars: 4, energy: 2, role: "verse" },
    { name: "Chorus", bars: 4, energy: 3, role: "chorus" },
    { name: "Verse2", bars: 4, energy: 2, role: "verse" },
  ];
  const base = PlanSchema.parse({ ...fixture.plan, chords, bpm: 125, timeSignature: [4, 4], sections });

  for (const variant of VARIANTS) {
    for (const seed of SEEDS) {
      const plan = colorPlan(base, bars, seed, { strength: 0.8, susProbability: variant.susProbability }).plan;
      const hinted = applyCorpusHints(plan, {
        prompt: fixture.name,
        dense: true,
        useStyleFit: variant.useStyleFit,
        useDrumDensityFit: variant.useDrumDensityFit,
        roleAware: variant.roleAware,
        modeProfiles: variant.modeProfiles,
      });
      const beatsPerBar = (hinted.timeSignature[0] * 4) / hinted.timeSignature[1];
      const sections = resolveSections(hinted, bars, beatsPerBar);
      const melody = melodyFor(hinted, bars);
      const score = assemble(hinted, sections, melody, bars, { seed, texture: true, arp: true });
      const fit = evaluateCorpusFit(hinted, score, corpusProfile, {
        complexity: "standard",
        // 評価用の旋律は決定的な合成音なので、旋律項目は全条件で同じ。比較の妨げにならないよう重み0
        weights: { melody: 0 },
      });
      rows.push({
        name: fixture.name,
        variant: variant.name,
        seed,
        total: fit.total,
        parts: fit.parts as unknown as Record<string, number>,
        comp: sections[0]?.comp ?? "-",
        bass: sections[0]?.bass ?? "-",
        drums: sections[0]?.drums ?? "-",
      });
    }
  }
}

const parts = ["tempo", "mode", "meter", "instruments", "rhythm", "drums", "drumDensity", "sectionDensity", "harmonicRhythm", "chordQualities", "borrowed", "form"] as const;
const summarize = (variant: string) => {
  const rs = rows.filter((r) => r.variant === variant);
  return {
    files: rs.length,
    total: round1(mean(rs.map((r) => r.total))),
    parts: Object.fromEntries(parts.map((p) => [p, round1(mean(rs.map((r) => (r.parts[p] ?? 0) * 100)))])),
  };
};
const summary = Object.fromEntries(VARIANTS.map((v) => [v.name, summarize(v.name)]));
const styles = (variant: string) => {
  const rs = rows.filter((r) => r.variant === variant);
  const count = (key: "comp" | "bass" | "drums") => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  };
  return { comp: count("comp"), bass: count("bass"), drums: count("drums") };
};

console.log("== summary ==");
for (const v of VARIANTS) console.log(v.name.padEnd(10), JSON.stringify(summary[v.name]));
console.log("== style distribution ==");
for (const v of VARIANTS) console.log(v.name.padEnd(10), JSON.stringify(styles(v.name)));
writeFileSync("out/corpus-arrangement-eval.json", JSON.stringify({ summary, styles: Object.fromEntries(VARIANTS.map((v) => [v.name, styles(v.name)])), rows }, null, 2));
console.log("wrote out/corpus-arrangement-eval.json");
