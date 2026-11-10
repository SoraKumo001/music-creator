// 和声評価: npx tsx scripts/eval-harmony.ts [fixtures-dir]
// フィクスチャの Plan を検証・補正し、指標を Markdown と JSON で出力する (ネットワーク不要)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAll, type EvalFixture } from "../src/eval/harmony";
import { PlanSchema } from "../src/plan";

const dir = process.argv[2] ?? "test/fixtures/plans";
const fixtures: EvalFixture[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; bars?: number; plan: unknown };
    return { name: raw.name ?? file.replace(/\.json$/, ""), bars: raw.bars ?? 8, plan: PlanSchema.parse(raw.plan) };
  });

const { rows, summary } = evaluateAll(fixtures);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => x.toFixed(2);

console.log(`# Harmony eval (${dir})`);
console.log("");
console.log("| fixture | bars | issues before | issues after | repairs | cadence | tonic end | diatonic |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.bars} | ${r.issuesBefore} | ${r.issuesAfter} | ${r.repairs} | ${r.cadence} | ${r.endingTonic ? "yes" : "no"} | ${pct(r.diatonic)} |`,
  );
}
console.log("");
console.log("## Summary");
console.log("");
console.log(`- fixtures: ${summary.count}`);
console.log(`- cadence rate: ${pct(summary.cadenceRate)}`);
console.log(`- ends on tonic: ${pct(summary.endingTonicRate)}`);
console.log(`- diatonic share: ${pct(summary.diatonicRate)}`);
console.log(`- plans with errors after repair: ${pct(summary.errorRateAfter)}`);
console.log(`- issues per plan: ${num(summary.avgIssuesBefore)} -> ${num(summary.avgIssuesAfter)}`);
console.log(`- repairs applied: ${summary.repairs}`);

mkdirSync("out", { recursive: true });
const outFile = `out/eval-${Date.now()}.json`;
writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), dir, rows, summary }, null, 2));
console.log(`\nwrote ${outFile}`);
