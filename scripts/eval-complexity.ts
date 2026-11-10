// 複雑さ評価: npm run eval:complexity
// test/fixtures/plans/*.json の現状ベースラインを計測する。ネットワーク不要。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateComplexity } from "../src/eval/complexity";
import { PlanSchema } from "../src/plan";

const dir = "test/fixtures/plans";
const inputs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; bars?: number; plan: unknown };
    return { name: raw.name ?? file.replace(/\.json$/, ""), bars: raw.bars ?? 8, plan: PlanSchema.parse(raw.plan) };
  });

const s = evaluateComplexity(inputs);
console.log("| 指標 | 値 |");
console.log("|---|---|");
console.log(`| 件数 | ${s.count} |`);
console.log(`| 平均セクション数 | ${s.avgSections} |`);
console.log(`| 平均コード種類数 | ${s.avgUniqueChords} |`);
console.log(`| 借用・二次ドミナント率 | ${s.borrowedRate} |`);
console.log(`| 転調あり率 | ${s.modulationRate} |`);
console.log(`| 総合スコア | ${s.score100} / 100 |`);
