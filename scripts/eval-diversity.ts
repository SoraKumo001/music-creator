// 多様性評価: npm run eval:diversity
// test/fixtures/plans/*.json を「同質化のベースライン」として計測する。ネットワーク不要。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateDiversity } from "../src/eval/diversity";
import { PlanSchema } from "../src/plan";

const dir = "test/fixtures/plans";
const inputs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; bars?: number; plan: unknown };
    return { name: raw.name ?? file.replace(/\.json$/, ""), bars: raw.bars ?? 8, plan: PlanSchema.parse(raw.plan) };
  });

const s = evaluateDiversity(inputs);
console.log("| 指標 | 値 | 目安 |");
console.log("|---|---|---|");
console.log(`| 件数 | ${s.count} | — |`);
console.log(`| 進行の重複なし率 | ${s.distinctProgressionRate.toFixed(2)} | 0.8+ を目標 |`);
console.log(`| 調・拍子のバラつき | ${s.keyVariety.toFixed(2)} | 高いほど多様 |`);
console.log(`| BPM標準偏差 | ${s.bpmStddev.toFixed(1)} | 10+ を目標 |`);
console.log(`| 平均コード数 | ${s.avgChords} | — |`);
console.log(`| 終止の種類数 | ${s.cadenceVariety} | 3+ を目標 |`);
console.log(`| 終止分布 | ${JSON.stringify(s.cadenceHistogram)} | V–I偏重なら要改善 |`);
