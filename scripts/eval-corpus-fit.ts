import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { requireLlmConfig } from "./_llm";
import { join } from "node:path";
import { assemble } from "../src/compose";
import { evaluateCorpusFit } from "../src/eval/corpusFit";
import { corpusProfile } from "../src/knowledge/corpus";
import type { CorpusProfile } from "../src/analyze/corpus";
import { PlanSchema, resolveSections } from "../src/plan";

const argOf = (name: string) => process.argv.find((a: string) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  const profile = corpusProfile;
  if (profile === null) {
    throw new Error("コーパスプロファイルがありません。先に npm run analyze:corpus を実行してください。");
  }
  const live = process.argv.includes("--live");
  const rows: { name: string; total: number; notes: string[]; parts?: Record<string, number> }[] = [];

  if (live) {
    const cfg = requireLlmConfig();
    const { compose } = await import("../src/compose");
    const prompts = argOf("prompts")?.split("|") ?? ["疾走感のあるロック", "静かなローファイ", "悲しいピアノバラード"];
    const bars = Number(argOf("bars") ?? 16);
    const complexities = (argOf("complexity")?.split("|") ?? ["standard", "rich"]) as ("simple" | "standard" | "rich")[];
    // コーパスの使い方を3条件で比較する: off / ルール層のみ / プロンプト+ルール
    type Condition = { key: string; corpusPrompt: boolean; corpusRules: boolean };
    const conditions: Condition[] = [
      { key: "off", corpusPrompt: false, corpusRules: false },
      { key: "rules", corpusPrompt: false, corpusRules: true },
      { key: "both", corpusPrompt: true, corpusRules: true },
    ];
    for (const prompt of prompts) {
      for (const complexity of complexities) {
        for (const cond of conditions) {
          const result = await compose(
            cfg,
            prompt, bars, { complexity, creativity: 0.5, seed: 7, corpusPrompt: cond.corpusPrompt, corpusRules: cond.corpusRules },
          );
          const fit = evaluateCorpusFit(result.plan, result.score, profile, { complexity });
          rows.push({ name: `${prompt} [${complexity}] corpus=${cond.key}`, total: fit.total, notes: fit.notes, parts: fit.parts as unknown as Record<string, number> });
        }
      }
    }
  } else if (process.argv.includes("--rules-ab")) {
    // 決定論的な A/B: 同じプランにコーパス由来のルールを適用する/しないだけを比較する
    const dir = "test/fixtures/plans";
    const { applyCorpusHints } = await import("../src/knowledge/corpus");
    const rowsDelta: { name: string; off: number; on: number; partsOff: Record<string, number>; partsOn: Record<string, number> }[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; plan: unknown; bars?: number };
      const plan = PlanSchema.parse(raw.plan);
      const bars = raw.bars ?? 8;
      const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
      const melody = [{ pitch: 72, start: 0, duration: 1, velocity: 90 }];
      const scoreOf = (p: typeof plan) => assemble(p, resolveSections(p, bars, beatsPerBar), melody, bars);
      const off = evaluateCorpusFit(plan, scoreOf(plan), profile);
      const onPlan = applyCorpusHints(plan);
      const on = evaluateCorpusFit(onPlan, scoreOf(onPlan), profile);
      rowsDelta.push({
        name: raw.name ?? file.replace(/\.json$/, ""),
        off: off.total, on: on.total,
        partsOff: off.parts as unknown as Record<string, number>,
        partsOn: on.parts as unknown as Record<string, number>,
      });
    }
    const meanOf = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    const partKeys = Object.keys(rowsDelta[0]?.partsOff ?? {});
    const partMean = (key: string, side: "partsOff" | "partsOn") =>
      meanOf(rowsDelta.map((r) => r[side][key] ?? 0)) * 100;
    const lines = [
      "# コーパスルール層の決定論的A/B",
      "",
      "同じプランにコーパス由来の既定値 (音色) を適用する/しないだけを比較 (LLMのばらつきなし)。",
      "",
      `- 適用なし: **${meanOf(rowsDelta.map((r) => r.off)).toFixed(1)}**`,
      `- 適用あり: **${meanOf(rowsDelta.map((r) => r.on)).toFixed(1)}**`,
      `- 差: **${(meanOf(rowsDelta.map((r) => r.on)) - meanOf(rowsDelta.map((r) => r.off))).toFixed(1)}**`,
      "",
      "| 項目 | 適用なし | 適用あり | 差 |",
      "|---|---|---|---|",
      ...partKeys.map((k) => {
        const a = partMean(k, "partsOff");
        const b = partMean(k, "partsOn");
        return `| ${k} | ${a.toFixed(0)} | ${b.toFixed(0)} | ${(b - a >= 0 ? "+" : "") + (b - a).toFixed(0)} |`;
      }),
      "",
      "| 曲 | 適用なし | 適用あり | 差 |",
      "|---|---|---|---|",
      ...rowsDelta.map((r) => `| ${r.name} | ${r.off} | ${r.on} | ${(r.on - r.off >= 0 ? "+" : "") + (r.on - r.off).toFixed(1)} |`),
    ];
    const text = lines.join("\n");
    console.log(text);
    mkdirSync("out", { recursive: true });
    const path = `out/corpus-rules-ab-${Date.now()}.md`;
    writeFileSync(path, text);
    console.log(`\nwrote ${path}`);
    return;
  } else {
    const dir = "test/fixtures/plans";
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; plan: unknown; bars?: number };
      const plan = PlanSchema.parse(raw.plan);
      const bars = raw.bars ?? 8;
      const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
      const sections = resolveSections(plan, bars, beatsPerBar);
      const score = assemble(plan, sections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], bars);
      const fit = evaluateCorpusFit(plan, score, profile);
      rows.push({ name: raw.name ?? file.replace(/\.json$/, ""), total: fit.total, notes: fit.notes });
    }
  }

  const mean = rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.total, 0) / rows.length;
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const lines = [
    "# コーパス適合度",
    "",
    "| 曲 | 適合度 | 気づき |",
    "|---|---|---|",
    ...sorted.map((r) => `| ${r.name} | ${r.total} | ${r.notes.join(" / ") || "—"} |`),
    "",
    `平均: **${mean.toFixed(1)} / 100** (${rows.length} 件${live ? " / live" : " / fixtures"})`,
  ];

  // 3条件 (off / rules / both) の比較。どの使い方が効くかを見る
  if (live) {
    const conditions = ["off", "rules", "both"];
    const byCond = (key: string) => rows.filter((r) => r.name.endsWith(`corpus=${key}`));
    const meanOf = (list: typeof rows) => (list.length === 0 ? 0 : list.reduce((a, r) => a + r.total, 0) / list.length);
    const partKeys = Object.keys(byCond("off")[0]?.parts ?? {});
    const partMean = (list: typeof rows, key: string) => {
      const vals = list.map((r) => r.parts?.[key]).filter((v): v is number => typeof v === "number");
      return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const base = byCond("off");
    lines.push(
      "",
      "## 条件比較 (off / ルール層のみ / プロンプト+ルール)",
      "",
      "| 条件 | 平均 | off差 |",
      "|---|---|---|",
      ...conditions.map((c) => {
        const list = byCond(c);
        const m = meanOf(list);
        return `| ${c} | ${m.toFixed(1)} (${list.length}件) | ${(m - meanOf(base) >= 0 ? "+" : "") + (m - meanOf(base)).toFixed(1)} |`;
      }),
      "",
      "### 項目別 (0-1 → 100点換算)",
      "",
      `| 項目 | ${conditions.join(" | ")} |`,
      `|---|---|---|---|`,
      ...partKeys.map((k) => `| ${k} | ${conditions.map((c) => (partMean(byCond(c), k) * 100).toFixed(0)).join(" | ")} |`),
      "",
      "| 曲 | off | rules | both |",
      "|---|---|---|---|",
      ...base.map((r) => {
        const key = r.name.replace(" corpus=off", "");
        const rules = byCond("rules").find((x) => x.name.replace(" corpus=rules", "") === key);
        const both = byCond("both").find((x) => x.name.replace(" corpus=both", "") === key);
        return `| ${key} | ${r.total} | ${rules?.total ?? "—"} | ${both?.total ?? "—"} |`;
      }),
    );
  }
  const text = lines.join("\n");
  console.log(text);
  mkdirSync("out", { recursive: true });
  const path = `out/corpus-fit-${Date.now()}.md`;
  writeFileSync(path, text);
  console.log(`\nwrote ${path}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});




