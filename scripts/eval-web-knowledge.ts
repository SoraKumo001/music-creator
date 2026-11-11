/**
 * Web由来の知識カード注入のA/B評価 CLI。
 *
 *   npm run eval:web-knowledge
 *   npm run eval:web-knowledge -- --prompts="疾走感のあるゲームBGM|静かなローファイ" --bars=8 --seeds=1,2
 *
 * 各プロンプト×seed について、注入OFF/ONの2曲を生成し、
 * 「コーパス適合度」「モード一致」「和声 issue」「生成時間」を比較する。
 * 出力: out/web-knowledge-ab.json / out/web-knowledge-ab.md
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { compose } from "../src/compose";
import { requireLlmConfig } from "./_llm";
import { CORPUS_PROFILE } from "../src/knowledge/corpus-profile.generated";
import { evaluateCorpusFit } from "../src/eval/corpusFit";
import { pickMode } from "../src/prompt";
import { parseKeyName } from "../src/theory/key";
import { hasWebKnowledge, webKnowledgeCards } from "../src/knowledge/web-knowledge";
import type { ComposeResult } from "../src/compose";

const argOf = (name: string) => process.argv.find((a: string) => a.startsWith(`--${name}=`))?.split("=")[1];

const bars = Number(argOf("bars") ?? 8);
const webFallback = !process.argv.includes("--no-web-fallback");
/** ルール層補正も含めるか (既定はプロンプト注入のみ。--web-rules で有効化) */
const webRules = process.argv.includes("--web-rules");
const prompts = (argOf("prompts") ?? "疾走感のあるアーケードゲームのBGM|ゲームのボス戦BGM|静かなローファイ|明るいEDM")
  .split("|")
  .map((s: string) => s.trim())
  .filter(Boolean);
const seeds = (argOf("seeds") ?? "1,2").split(",").map((s: string) => Number(s.trim()));

type Row = {
  prompt: string;
  seed: number;
  web: boolean;
  key: string;
  mode: string;
  modeExpected: string;
  modeMatch: boolean;
  corpusFit: number | null;
  corpusFitParts: Record<string, number> | null;
  attempts: number;
  issueErrors: number;
  issueWarns: number;
  /** Web知識由来のクラフト評価 (0-100) */
  craft: number;
  ms: number;
  tokens: number;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
};
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** プロバイダのハングで評価全体が止まらないよう、1曲に上限を設ける */
const COMPOSE_TIMEOUT_MS = Number(argOf("timeout-ms") ?? 180_000);
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function measure(result: ComposeResult, prompt: string, seed: number, web: boolean): Row {
  const expectedMode = pickMode(prompt, seed + 0); // compose 内の seed 解決と同じ (明示seed)
  const mode = parseKeyName(result.plan.key).mode;
  const fit = CORPUS_PROFILE ? evaluateCorpusFit(result.plan, result.score, CORPUS_PROFILE, { complexity: "standard" }) : null;
  return {
    prompt,
    seed,
    web,
    key: result.plan.key,
    mode,
    modeExpected: expectedMode,
    modeMatch: mode === expectedMode,
    corpusFit: fit ? fit.total : null,
    corpusFitParts: fit ? (fit.parts as unknown as Record<string, number>) : null,
    attempts: result.attempts,
    issueErrors: result.issues.filter((i) => i.severity === "error").length,
    issueWarns: result.issues.filter((i) => i.severity === "warn").length,
    craft: result.craft.score,
    ms: result.stats.ms,
    tokens: result.stats.outputTokens,
  };
}

async function main() {
  const cfg = requireLlmConfig();
  if (!hasWebKnowledge()) {
    console.error("Web知識カードが空です。先に npm run collect:knowledge を実行してください。");
    process.exit(1);
  }
  console.log(`Web知識カード: ${webKnowledgeCards.length} 枚 / 条件: ${prompts.length}プロンプト × ${seeds.length}seed × 2条件`);
  const rows: Row[] = [];
  for (const prompt of prompts) {
    for (const seed of seeds) {
      for (const web of [false, true]) {
        const t0 = Date.now();
        try {
          const result = await withTimeout(
            compose(cfg, prompt, bars, {
              seed,
              creativity: 0.5,
              complexity: "standard",
              webKnowledge: web,
              webFallback,
              webRules,
            }),
            COMPOSE_TIMEOUT_MS,
            `${prompt} seed=${seed} web=${web}`,
          );
          const row = measure(result, prompt, seed, web);
          rows.push(row);
          console.log(
            `${web ? "ON " : "OFF"} ${prompt} seed=${seed} -> ${row.key} fit=${row.corpusFit ?? "-"} ` +
            `mode=${row.modeMatch ? "OK" : "NG"} issues=${row.issueErrors}E/${row.issueWarns}W attempts=${row.attempts} ${Date.now() - t0}ms`,
          );
        } catch (e) {
          console.log(`FAILED ${prompt} seed=${seed} web=${web}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
        }
      }
    }
  }
  if (rows.length === 0) throw new Error("評価できた曲がありません");

  const summarize = (web: boolean) => {
    const rs = rows.filter((r) => r.web === web);
    const fits = rs.map((r) => r.corpusFit ?? 0);
    return {
      songs: rs.length,
      corpusFitMean: Math.round(mean(fits) * 10) / 10,
      corpusFitMedian: Math.round(median(fits) * 10) / 10,
      craftMean: Math.round(mean(rs.map((r) => r.craft)) * 10) / 10,
      modeMatchRate: Math.round((rs.filter((r) => r.modeMatch).length / rs.length) * 100) / 100,
      issuesErrors: rs.reduce((a, r) => a + r.issueErrors, 0),
      issuesWarns: rs.reduce((a, r) => a + r.issueWarns, 0),
      avgAttempts: Math.round(mean(rs.map((r) => r.attempts)) * 100) / 100,
      tokenMean: Math.round(mean(rs.map((r) => r.tokens))),
      msMedian: Math.round(median(rs.map((r) => r.ms))),
    };
  };
  const off = summarize(false);
  const on = summarize(true);
  const delta = (k: keyof typeof off) => {
    const a = off[k] as number;
    const b = on[k] as number;
    return Math.round((b - a) * 100) / 100;
  };

  // 同一プロンプト+seedのペアごとのコーパス適合度差 (ノイズを抑えた比較)
  const pairs = new Map<string, { off?: number; on?: number }>();
  for (const r of rows) {
    const key = `${r.prompt}|${r.seed}`;
    const p = pairs.get(key) ?? {};
    if (r.web) p.on = r.corpusFit ?? 0;
    else p.off = r.corpusFit ?? 0;
    pairs.set(key, p);
  }
  const pairDeltas = [...pairs.values()].filter((p) => p.off !== undefined && p.on !== undefined).map((p) => p.on! - p.off!);

  const report = [
    "# Web知識カード A/B 評価",
    "",
    `生成: ${new Date().toISOString()}`,
    `条件: bars=${bars} / prompts=${prompts.length} / seeds=${seeds.join(",")} / webFallback=${webFallback} / 知識カード ${webKnowledgeCards.length} 枚`,
    "",
    "| 指標 | OFF | ON | 差 |",
    "|---|---|---|---|",
    `| コーパス適合度 (mean) | ${off.corpusFitMean} | ${on.corpusFitMean} | ${delta("corpusFitMean")} |`,
    `| コーパス適合度 (median) | ${off.corpusFitMedian} | ${on.corpusFitMedian} | ${delta("corpusFitMedian")} |`,
    `| ペア内差 (mean) | — | — | ${Math.round(mean(pairDeltas) * 10) / 10} |`,
    `| クラフト評価 (mean) | ${off.craftMean} | ${on.craftMean} | ${delta("craftMean")} |`,
    `| モード一致率 | ${off.modeMatchRate} | ${on.modeMatchRate} | ${delta("modeMatchRate")} |`,
    `| 和声 error 合計 | ${off.issuesErrors} | ${on.issuesErrors} | ${delta("issuesErrors")} |`,
    `| 和声 warn 合計 | ${off.issuesWarns} | ${on.issuesWarns} | ${delta("issuesWarns")} |`,
    `| 平均プラン試行回数 | ${off.avgAttempts} | ${on.avgAttempts} | ${delta("avgAttempts")} |`,
    `| 出力トークン平均 | ${off.tokenMean} | ${on.tokenMean} | ${delta("tokenMean")} |`,
    `| 生成時間 median (ms) | ${off.msMedian} | ${on.msMedian} | ${delta("msMedian")} |`,
    "",
    "## 曲ごとの結果",
    "",
    "| prompt | seed | key | mode一致 | fit OFF | fit ON |",
    "|---|---|---|---|---|---|",
    ...[...pairs.entries()].map(([key, p]) => {
      const [prompt, seed] = key.split("|");
      const rowOn = rows.find((r) => r.prompt === prompt && String(r.seed) === seed && r.web);
      return `| ${prompt} | ${seed} | ${rowOn?.key ?? "-"} | ${rowOn?.modeMatch ? "OK" : "NG"} | ${p.off?.toFixed(1) ?? "-"} | ${p.on?.toFixed(1) ?? "-"} |`;
    }),
    "",
    "> n が小さいため、これは方向性を見るためのスモークテストです。本判定には条件あたり10曲以上を推奨。",
    "",
  ].join("\n");

  mkdirSync("out", { recursive: true });
  writeFileSync("out/web-knowledge-ab.json", JSON.stringify({ off, on, pairDeltas, rows }, null, 2));
  writeFileSync("out/web-knowledge-ab.md", report);
  console.log("");
  console.log(report);
  console.log("wrote out/web-knowledge-ab.json / out/web-knowledge-ab.md");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
