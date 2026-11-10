/**
 * コーパスとの比較 CLI。
 * 参照 MIDI 群と自前の生成曲を「同じ解析器」に通し、特徴量の分布を並べる。
 *
 *   npm run compare:corpus                 … 保存済みフィクスチャ (伴奏のみ) と比較。ネットワーク不要
 *   npm run compare:corpus -- --live       … LLM で実際に生成して比較 (要 .dev.vars)
 *
 * 目的は「サイトの曲にどこまで近いか」を主観ではなく数値で把握すること。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../src/compose";
import { extractFeatures, type MidiFeatures } from "../src/analyze/features";
import { parseMidi } from "../src/midi/parseMidi";
import { scoreToMidi } from "../src/midi/toMidi";
import { PlanSchema, resolveSections } from "../src/plan";

const argOf = (name: string) => process.argv.find((a: string) => a.startsWith(`--${name}=`))?.split("=")[1];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!.trim();
    }
  }
  return env;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const distinctDrums = (f: MidiFeatures) => Object.keys(f.drumHits).length;
const distinctPrograms = (f: MidiFeatures) => Object.keys(f.programs).length;
const sectionCount = (f: MidiFeatures) => f.sectionBars.length;

type Metric = { label: string; get: (f: MidiFeatures) => number };

const METRICS: Metric[] = [
  { label: "長さ (秒)", get: (f) => f.durationSec },
  { label: "小節数", get: (f) => f.bars },
  { label: "トラック数", get: (f) => f.tracks },
  { label: "使用チャンネル数", get: (f) => f.channels },
  { label: "ノート数", get: (f) => f.noteCount },
  { label: "密度 (音/秒)", get: (f) => f.density },
  { label: "平均同時発音数", get: (f) => f.polyphonyMean },
  { label: "セクション数", get: sectionCount },
  { label: "セクション長 (小節)", get: (f) => (f.sectionBars.length ? f.sectionBars.reduce((a, b) => a + b, 0) / f.sectionBars.length : 0) },
  { label: "コード/小節", get: (f) => f.chordsPerBar },
  { label: "借用・二次ドミナント率", get: (f) => f.borrowedRate },
  { label: "音色の種類数", get: distinctPrograms },
  { label: "ドラム音の種類数", get: distinctDrums },
  { label: "16分の割合", get: (f) => f.sixteenthShare },
  { label: "旋律音域 (半音)", get: (f) => f.melodyRange },
  { label: "旋律 音/小節", get: (f) => f.melodyNotesPerBar },
  { label: "音程 (順次進行の割合)", get: (f) => f.intervalHistogram.slice(1, 3).reduce((a, b) => a + b, 0) },
];

async function corpusFeatures(): Promise<MidiFeatures[]> {
  const dir = argOf("corpus-dir") ?? "out/corpus";
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /\.midi?$/i.test(f));
  const out: MidiFeatures[] = [];
  for (const file of files) {
    try {
      const midi = parseMidi(new Uint8Array(readFileSync(join(dir, file))));
      if (midi.tracks.reduce((n, t) => n + t.notes.length, 0) < 8) continue;
      out.push(extractFeatures(file, midi));
    } catch { /* skip */ }
  }
  return out;
}

async function generatedFeatures(): Promise<MidiFeatures[]> {
  const live = process.argv.includes("--live");
  if (!live) {
    // フィクスチャ: 伴奏 + 単一旋律で組み立てた最小構成
    const dir = "test/fixtures/plans";
    const out: MidiFeatures[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { plan: unknown; bars?: number };
      const plan = PlanSchema.parse(raw.plan);
      const bars = raw.bars ?? 8;
      const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
      const sections = resolveSections(plan, bars, beatsPerBar);
      const score = assemble(plan, sections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], bars);
      try {
        out.push(extractFeatures(file, parseMidi(scoreToMidi(score))));
      } catch { /* skip */ }
    }
    return out;
  }

  const env = loadEnv();
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is not set (.dev.vars)");
  const { compose } = await import("../src/compose");
  const bars = Number(argOf("bars") ?? 32);
  const prompts = argOf("prompts")?.split("|") ?? ["疾走感のあるゲームステージBGM", "静かなローファイ", "明るいアニメ風ポップ", "ダークなボス戦BGM"];
  const out: MidiFeatures[] = [];
  mkdirSync("out/generated", { recursive: true });
  for (const prompt of prompts) {
    const result = await compose(
      {
        baseUrl: env.LLM_BASE_URL ?? "https://opencode.ai/inference/go/openai/v1",
        model: env.LLM_MODEL ?? "deepseek-v4.1-flash",
        apiKey: env.LLM_API_KEY,
        extraBody: { thinking: { type: "disabled" } },
      },
      prompt, bars, { complexity: "rich", creativity: 0.5, seed: 11 },
    );
    const path = `out/generated/${out.length + 1}-${prompt.slice(0, 12).replace(/[\\/:*?"<>|]/g, "_")}.mid`;
    writeFileSync(path, result.midi);
    out.push(extractFeatures(path, parseMidi(result.midi)));
    console.log(`generated: ${path} (${result.score.tracks.length} tracks, ${result.score.bpm}BPM ${result.score.key})`);
  }
  return out;
}

async function main() {
  const corpus = await corpusFeatures();
  if (corpus.length === 0) {
    console.error("out/corpus に MIDI がありません。先に npm run analyze:corpus を実行してください。");
    process.exit(1);
  }
  const ours = await generatedFeatures();
  if (ours.length === 0) throw new Error("比較対象の生成曲がありません");

  const rows = METRICS.map((m) => {
    const c = median(corpus.map(m.get));
    const o = median(ours.map(m.get));
    const ratio = c === 0 ? 0 : o / c;
    return { label: m.label, corpus: c, ours: o, ratio };
  });

  const fmt = (x: number) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100);
  const perSong = [
    "",
    "## 生成曲ごとの値",
    "",
    "| 曲 | 小節 | ノート | 密度 | チャンネル | セクション数 | セクション長 | 借用率 | 16分 | 旋律音域 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...ours.map((f) =>
      `| ${f.name} | ${Math.round(f.bars)} | ${f.noteCount} | ${fmt(f.density)} | ${f.channels} | ${f.sectionBars.length} | ${fmt(f.sectionBars.length ? f.sectionBars.reduce((a, b) => a + b, 0) / f.sectionBars.length : 0)} | ${fmt(f.borrowedRate)} | ${fmt(f.sixteenthShare)} | ${Math.round(f.melodyRange)} |`,
    ),
  ];
  const lines = [
    "# コーパスとの比較（中央値）",
    "",
    `参照 MIDI: ${corpus.length} 曲 / 比較対象: ${ours.length} 曲`,
    "",
    "| 指標 | 参照MIDI | 生成物 | 比 (生成/参照) |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.label} | ${fmt(r.corpus)} | ${fmt(r.ours)} | ${r.corpus === 0 ? "—" : r.ratio.toFixed(2)} |`),
    ...perSong,
  ];
  const text = lines.join("\n");
  console.log("\n" + text);
  mkdirSync("out", { recursive: true });
  const path = `out/compare-corpus-${Date.now()}.md`;
  writeFileSync(path, text);
  console.log(`\nwrote ${path}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

