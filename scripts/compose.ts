// フェーズ0: ローカル疎通検証。 npm run compose -- "ローファイな夜のBGM" [bars]
// 接続先は環境変数で切り替え (docs/llm-provider.md 参照)
import { mkdirSync, writeFileSync } from "node:fs";
import { compose } from "../src/compose";
import { requireLlmConfig } from "./_llm";

const cfg = requireLlmConfig();
const prompt = process.argv[2];
const bars = Number(process.argv[3] ?? 8);
const seedArg = process.argv.find((a: string) => a.startsWith("--seed="));
const creativityArg = process.argv.find((a: string) => a.startsWith("--creativity="));
const complexityArg = process.argv.find((a: string) => a.startsWith("--complexity="));
if (!prompt) throw new Error('usage: npm run compose -- "<prompt>" [bars] [--seed=N] [--creativity=0-1] [--complexity=simple|standard|rich]');

const t0 = Date.now();
const { score, midi, sections, stats } = await compose(
  cfg,
  prompt,
  bars,
  {
    seed: seedArg ? Number(seedArg.split("=")[1]) : undefined,
    creativity: creativityArg ? Number(creativityArg.split("=")[1]) : 0.7,
    complexity: (complexityArg ? complexityArg.split("=")[1] : "standard") as "simple" | "standard" | "rich",
  },
);
mkdirSync("out", { recursive: true });
const base = `out/${Date.now()}`;
writeFileSync(`${base}.mid`, midi);
writeFileSync(`${base}.json`, JSON.stringify(score, null, 2));
console.log(`OK: ${base}.mid (${score.tracks.length} tracks, ${Date.now() - t0}ms)`);
console.log("sections:", sections.map((s) => `${s.name}(${s.bars})`).join(" "));
console.log("stats:", JSON.stringify(stats));
