/**
 * 不協和音の評価 CLI。
 *
 *   npm run eval:dissonance              … フィクスチャで測定 (ネットワーク不要)
 *   npm run eval:dissonance -- --live    … LLMで生成して測定 (要 .dev.vars)
 *
 * 「後処理なし」と「後処理あり」を同じプランで比較し、修正数と残存数を出す。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { requireLlmConfig } from "./_llm";
import { join } from "node:path";
import { assemble } from "../src/compose";
import { PlanSchema, resolveSections } from "../src/plan";
import { chordAt, type ChordEvent } from "../src/theory/accompaniment";
import { findDissonances, reduceDissonances } from "../src/theory/dissonance";
import { SCALES } from "../src/theory/index";
import { parseKeyName } from "../src/theory/key";

const argOf = (name: string) => process.argv.find((a: string) => a.startsWith(`--${name}=`))?.split("=")[1];

type Row = { name: string; notes: number; before: number; after: number; fixes: number; actions: Record<string, number>; pairs: Record<string, number> };

function countPer100(count: number, notes: number): string {
  return notes === 0 ? "—" : ((count / notes) * 100).toFixed(2);
}

function analyze(name: string, plan: Parameters<typeof assemble>[0], sections: ReturnType<typeof resolveSections>, melody: Parameters<typeof assemble>[2], bars: number): Row {
  const score = assemble(plan, sections, melody, bars, { texture: true, arp: true, seed: 7 });
  const tracks = score.tracks.map((t) => ({ name: t.name, channel: t.channel, notes: t.notes }));
  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const hits0 = findDissonances(tracks);
  const before = hits0.length;
  const pairs: Record<string, number> = {};
  for (const hit of hits0) {
    const key = [hit.a.track, hit.b.track].sort().join(" × ");
    pairs[key] = (pairs[key] ?? 0) + 1;
  }
  const result = reduceDissonances(tracks, {
    chordTonesAt: (beat) => chordAt(events, beat).tones,
    scaleTonesAt: (beat) => {
      const { root, mode } = parseKeyName(plan.key);
      void beat;
      return SCALES[mode]!.map((i) => (i + root) % 12);
    },
  });
  void beatsPerBar;
  return {
    name,
    notes: tracks.reduce((n, t) => n + t.notes.length, 0),
    before,
    after: result.remaining.length,
    fixes: result.fixes.length,
    actions: result.fixes.reduce<Record<string, number>>((acc, f) => { acc[f.action] = (acc[f.action] ?? 0) + 1; return acc; }, {}),
    pairs,
  };
}

async function main() {
  const live = process.argv.includes("--live");
  const rows: Row[] = [];

  if (live) {
    const cfg = requireLlmConfig();
    const { compose } = await import("../src/compose");
    const prompts = argOf("prompts")?.split("|") ?? ["疾走感のあるゲームステージBGM", "静かなローファイ", "明るいアニメ風ポップ"];
    const bars = Number(argOf("bars") ?? 32);
    for (const prompt of prompts) {
      const result = await compose(
        cfg,
        prompt, bars, { complexity: "rich", creativity: 0.5, seed: 7 },
      );
      // 後処理は compose 内で既に適用済み。同じプランから再構成して比較する
      const sections = resolveSections(result.plan, bars, (result.plan.timeSignature[0] * 4) / result.plan.timeSignature[1]);
      const raw = assemble(result.plan, sections, result.score.tracks.find((t) => t.channel === 0)?.notes ?? [], bars, {
        texture: true, arp: true, seed: 7,
      });
      const tracks = raw.tracks.map((t) => ({ name: t.name, channel: t.channel, notes: t.notes }));
      const events: ChordEvent[] = result.plan.chords.map(([start, symbol]) => ({ start, symbol }));
      const hits0 = findDissonances(tracks);
      const before = hits0.length;
      const pairs: Record<string, number> = {};
      for (const hit of hits0) {
        const key = [hit.a.track, hit.b.track].sort().join(" × ");
        pairs[key] = (pairs[key] ?? 0) + 1;
      }
      const reduced = reduceDissonances(tracks, {
        chordTonesAt: (beat) => chordAt(events, beat).tones,
        scaleTonesAt: () => {
          const { root, mode } = parseKeyName(result.plan.key);
          return SCALES[mode]!.map((i) => (i + root) % 12);
        },
      });
      rows.push({
        name: prompt,
        notes: tracks.reduce((n, t) => n + t.notes.length, 0),
        before,
        after: reduced.remaining.length,
        fixes: reduced.fixes.length,
        actions: reduced.fixes.reduce<Record<string, number>>((acc, f) => { acc[f.action] = (acc[f.action] ?? 0) + 1; return acc; }, {}),
        pairs,
      });
    }
  } else {
    const dir = "test/fixtures/plans";
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; plan: unknown; bars?: number };
      const plan = PlanSchema.parse(raw.plan);
      const bars = raw.bars ?? 8;
      const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
      const sections = resolveSections(plan, bars, beatsPerBar);
      // 単旋律を用意 (フィクスチャには旋律が無いため、コードトーン中心の定型を作る)
      const melody = Array.from({ length: bars * 2 }, (_, i) => ({
        pitch: 72 + [0, 4, 7, 4, 9, 7, 4, 0][i % 8]!,
        start: i * 0.5,
        duration: 0.45,
        velocity: 90,
      }));
      rows.push(analyze(raw.name ?? file.replace(/\.json$/, ""), plan, sections, melody, bars));
    }
  }

  void 0;
  const totalNotes = rows.reduce((a, r) => a + r.notes, 0);
  const totalBefore = rows.reduce((a, r) => a + r.before, 0);
  const totalAfter = rows.reduce((a, r) => a + r.after, 0);
  const lines = [
    "# 不協和音の評価",
    "",
    `対象: ${rows.length} 曲 / 音符 ${totalNotes}`,
    "",
    "| 曲 | 音符 | 後処理前 | 後処理後 | 修正数 |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.notes} | ${r.before} (${countPer100(r.before, r.notes)}/100音) | ${r.after} (${countPer100(r.after, r.notes)}/100音) | ${r.fixes} |`),
    "",
    `合計: **${totalBefore} → ${totalAfter}** (${countPer100(totalBefore, totalNotes)} → ${countPer100(totalAfter, totalNotes)} per 100音)`,
    "",
    "## 修正の内訳",
    "",
    "| 曲 | repitch | trim | drop | 主な衝突ペア |",
    "|---|---|---|---|---|",
    ...rows.map((r) => { const p = Object.entries(r.pairs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(", "); return `| ${r.name} | ${r.actions.repitch ?? 0} | ${r.actions.trim ?? 0} | ${r.actions.drop ?? 0} | ${p || "—"} |`; }),
  ];
  const text = lines.join("\n");
  console.log("\n" + text);
  mkdirSync("out", { recursive: true });
  const path = `out/dissonance-${Date.now()}.md`;
  writeFileSync(path, text);
  console.log(`\nwrote ${path}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});





