/**
 * MIDI コーパスの取得・解析・集計 CLI。
 *
 *   npm run analyze:corpus -- --url https://example.com/midi.html --limit 40
 *   npm run analyze:corpus -- --dir out/corpus --no-fetch
 *
 * 出力:
 *   out/corpus-features.json      … 1曲ごとの特徴 (検査用)
 *   out/corpus-profile.json       … 集計プロファイル
 *   out/corpus-report.md          … 人が読むレポート
 *   src/knowledge/corpus-profile.generated.ts … 生成側が読む集計データ
 *
 * 注意: 取得した MIDI はキャッシュ (既定 out/corpus、gitignore 済み) に置くだけで、
 * リポジトリへは含めない。出力するのは集計統計のみで、旋律・譜面は保存しない。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { aggregateFeatures, drumName, type CorpusProfile } from "../src/analyze/corpus";
import { extractFeatures, type MidiFeatures } from "../src/analyze/features";
import { aggregateDrumPatterns, extractDrumBarPatterns } from "../src/analyze/patterns";
import { extractMidiLinks, safeLocalName } from "../src/analyze/links";
import { parseMidi } from "../src/midi/parseMidi";
import { parseKeyName } from "../src/theory/key";

type Args = {
  url?: string;
  dir: string;
  limit: number;
  delay: number;
  noFetch: boolean;
  label: string;
  outJson: string;
  outGenerated: string;
  outReport: string;
  featuresJson: string;
  outDrumPatterns: string;
  minPatternBars: number;
  userAgent: string;
  /** 長調/短調のサブプロファイルも生成する */
  splitMode: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const withEq = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEq) return withEq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
    return undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  return {
    url: get("url"),
    dir: get("dir") ?? "out/corpus",
    limit: Number(get("limit") ?? 30),
    delay: Number(get("delay") ?? 800),
    noFetch: has("no-fetch"),
    label: get("label") ?? "midi-corpus",
    outJson: get("out") ?? "out/corpus-profile.json",
    outGenerated: get("generated") ?? "src/knowledge/corpus-profile.generated.ts",
    outReport: get("report") ?? "out/corpus-report.md",
    featuresJson: get("features") ?? "out/corpus-features.json",
    outDrumPatterns: get("drum-patterns") ?? "src/knowledge/drum-patterns.generated.ts",
    minPatternBars: Number(get("min-pattern-bars") ?? 8),
    userAgent: get("user-agent") ?? "music-creator-corpus/0.1 (analysis only; no redistribution)",
    splitMode: has("split-mode"),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


async function fetchText(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchBinary(url: string, userAgent: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}


function fmtTable(rows: [string, string][]): string {
  return ["| 指標 | 値 |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function reportOf(profile: CorpusProfile): string {
  const p = profile;
  const rows: [string, string][] = [
    ["解析ファイル数", `${p.source.analyzed}`],
    ["拍節を実測推定した割合", `${Math.round(p.source.inferredBarShare * 100)}%`],
    ["テンポ (p10 / median / p90)", `${p.tempo.p10} / ${p.tempo.median} / ${p.tempo.p90} BPM`],
    ["拍子", Object.entries(p.meters).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")],
    ["長調:短調", `${Math.round(p.modeShare.major * 100)} : ${Math.round(p.modeShare.minor * 100)}`],
    ["主な楽器 (ノート数比)", Object.entries(p.instruments).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")],
    ["主なドラム", Object.entries(p.drums).slice(0, 5).map(([k, v]) => `${drumName(Number(k))} ${Math.round(v * 100)}%`).join(", ")],
    ["ダウンビート比率", `${Math.round(p.rhythm.downbeatShare * 100)}%`],
    ["16分比率", `${Math.round(p.rhythm.sixteenthShare * 100)}%`],
    ["グリッド外の比率", `${Math.round(p.rhythm.offGridShare * 100)}%`],
    ["和声リズム (コード/小節)", `${p.harmony.medianChordsPerBar}`],
    ["借用・二次ドミナント率", `${Math.round(p.harmony.borrowedRate * 100)}%`],
    ["セクション長 (p10/median/p90)", `${p.form.sectionBarPercentiles.join(" / ")} 小節`],
    ["1曲のセクション数 中央値", `${p.form.medianSections}`],
  ];
  return [
    `# MIDI コーパス解析レポート (${p.source.label})`,
    "",
    `生成日時: ${p.generatedAt}`,
    "",
    fmtTable(rows),
    "",
    "## 生成に使う知見",
    "",
    ...p.insights.map((line) => `- ${line}`),
    "",
    "## 上位のローマ数字2連",
    "",
    ...p.harmony.topBigrams.map((b) => `- ${b.pair.replace(">", " → ")}: ${Math.round(b.share * 100)}%`),
    "",
    "## 上位の3コード・セル",
    "",
    ...p.harmony.topProgressions.map((b) => `- ${b.numerals.replace(/>/g, " – ")}: ${Math.round(b.share * 100)}%`),
    "",
    "> このファイルは集計統計のみを含む。元 MIDI の旋律・譜面は出力していない。",
  ].join("\n");
}

function generatedModule(
  profile: CorpusProfile,
  byMode: { major: CorpusProfile; minor: CorpusProfile } | null = null,
): string {
  return [
    "// AUTO-GENERATED FILE — do not edit by hand.",
    "// 生成: npm run analyze:corpus",
    '// このデータは MIDI コーパスの集計統計のみ (旋律・譜面は含まない)。',
    'import type { CorpusProfile } from "../analyze/corpus";',
    "",
    `export const CORPUS_PROFILE: CorpusProfile | null = ${JSON.stringify(profile, null, 2)};`,
    "",
    `export const CORPUS_PROFILES_BY_MODE: { major: CorpusProfile; minor: CorpusProfile } | null = ${
      byMode ? JSON.stringify(byMode, null, 2) : "null"
    };`,
    "",
  ].join("\n");
}

/** コーパスから抽出したドラムパターンの TS モジュール */
function drumPatternsModule(patterns: { name: string; steps: [number, string, number][] }[]): string {
  return [
    "// AUTO-GENERATED FILE — do not edit by hand.",
    "// 生成: npm run analyze:corpus",
    "// コーパスのMIDIから抽出した1小節ドラムパターン (旋律は含まない)。",
    "export type CorpusDrumPattern = { name: string; steps: [number, string, number][] };",
    "",
    `export const CORPUS_DRUM_PATTERNS: CorpusDrumPattern[] = ${JSON.stringify(patterns, null, 2)};`,
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.dir, { recursive: true });

  // ---- 1. 取得 ----
  const cache = new Map<string, string>(); // 表示名 -> ローカルパス
  const existing = existsSync(args.dir) ? readdirSync(args.dir).filter((f) => /\.midi?$/i.test(f)) : [];
  if (!args.noFetch) {
    if (!args.url) throw new Error("--url を指定するか、--no-fetch でローカル解析してください");
    console.log(`ページ取得: ${args.url}`);
    const html = await fetchText(args.url, args.userAgent);
    const links = extractMidiLinks(html, args.url);
    console.log(`MIDIリンク: ${links.length} 件 (先頭 ${Math.min(args.limit, links.length)} 件を対象)`);

    const targets = links.slice(0, args.limit);
    let downloaded = 0;
    for (let i = 0; i < targets.length; i++) {
      const url = targets[i]!;
      const name = safeLocalName(url, i);
      const path = join(args.dir, name);
      if (existsSync(path)) { cache.set(name, path); continue; }
      try {
        const bytes = await fetchBinary(encodeURI(url), args.userAgent);
        writeFileSync(path, bytes);
        cache.set(name, path);
        downloaded++;
        process.stdout.write(`  [${i + 1}/${targets.length}] ${name} (${bytes.length} bytes)\n`);
      } catch (e) {
        console.warn(`  [${i + 1}/${targets.length}] 失敗 ${name}: ${e instanceof Error ? e.message : e}`);
      }
      // 相手先に負荷をかけない
      await sleep(args.delay);
    }
    console.log(`新規ダウンロード: ${downloaded} 件 / キャッシュ ${existing.length} 件`);
  }

  // ---- 2. 解析 ----
  const files = readdirSync(args.dir).filter((f) => /\.midi?$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`${args.dir} に MIDI ファイルがありません (--url で取得するか --dir を指定)`);
  const features: MidiFeatures[] = [];
  const drumBars: { key: string; steps: [number, string, number][] }[][] = [];
  let skipped = 0;
  for (const file of files) {
    const path = join(args.dir, file);
    try {
      const midi = parseMidi(new Uint8Array(readFileSync(path)));
      if (midi.tracks.reduce((n, t) => n + t.notes.length, 0) < 8) { skipped++; continue; }
      features.push(extractFeatures(basename(file, ".mid"), midi));
      try {
        const bars = extractDrumBarPatterns(midi);
        if (bars.length > 0) drumBars.push(bars);
      } catch { /* ドラム抽出の失敗は無視 */ }
    } catch (e) {
      skipped++;
      console.warn(`  解析失敗 ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`解析: ${features.length} 件 (スキップ ${skipped} 件)`);

  // ---- 3. 集計 ----
  const profile = aggregateFeatures(features, { label: args.label });
  // 長調/短調のサブプロファイル (楽器構成・リズム・ドラムは調性で偏るため)
  let byMode: { major: CorpusProfile; minor: CorpusProfile } | null = null;
  if (args.splitMode) {
    const major = features.filter((f) => parseKeyName(f.key).mode === "major");
    const minor = features.filter((f) => parseKeyName(f.key).mode === "minor");
    if (major.length >= 4 && minor.length >= 4) {
      byMode = {
        major: aggregateFeatures(major, { label: `${args.label}-major` }),
        minor: aggregateFeatures(minor, { label: `${args.label}-minor` }),
      };
    } else {
      console.warn(`--split-mode: 件数不足のためサブプロファイルは生成しません (major ${major.length} / minor ${minor.length})`);
    }
  }
  // ドラムパターンの抽出 (頻出する1小節を最大8個)
  const drumCandidates = aggregateDrumPatterns(drumBars, 8, args.minPatternBars);
  const drumPatterns = drumCandidates.map((p, i) => ({ name: `corpus${i + 1}`, steps: p.steps }));
  profile.source.files = files.length;
  profile.source.skipped = skipped;

  // ---- 4. 出力 ----
  mkdirSync("out", { recursive: true });
  writeFileSync(args.featuresJson, JSON.stringify(features, null, 2));
  writeFileSync(args.outJson, JSON.stringify(profile, null, 2));
  writeFileSync(args.outReport, reportOf(profile));
  mkdirSync(join(args.outGenerated, ".."), { recursive: true });
  writeFileSync(args.outGenerated, generatedModule(profile, byMode));
  if (byMode) {
    writeFileSync("out/corpus-profile-major.json", JSON.stringify(byMode.major, null, 2));
    writeFileSync("out/corpus-profile-minor.json", JSON.stringify(byMode.minor, null, 2));
  }
  const drumOut = args.outDrumPatterns;
  writeFileSync(drumOut, drumPatternsModule(drumPatterns));

  console.log("");
  console.log(reportOf(profile));
  console.log("");
  console.log(`書き出し: ${args.outJson} / ${args.outReport} / ${args.outGenerated}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});





