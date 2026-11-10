// フェーズ0: ローカル疎通検証。 npm run compose -- "ローファイな夜のBGM" [bars]
// 実験用: LLM_EXTRA_BODY='{"thinking":{"type":"disabled"}}' でリクエストbodyに追加パラメータを混ぜられる
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compose } from "../src/compose";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!;
    }
  }
  return env;
}

const env = loadEnv();
const prompt = process.argv[2];
const bars = Number(process.argv[3] ?? 8);
if (!prompt) throw new Error('usage: npm run compose -- "<prompt>" [bars]');
if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is not set (.dev.vars)");

const t0 = Date.now();
const { score, midi, sections, stats } = await compose(
  {
    baseUrl: env.LLM_BASE_URL ?? "https://opencode.ai/inference/go/openai/v1",
    model: env.LLM_MODEL ?? "deepseek-v4.1-flash",
    apiKey: env.LLM_API_KEY,
    extraBody: env.LLM_EXTRA_BODY === undefined ? { thinking: { type: "disabled" } } : env.LLM_EXTRA_BODY ? JSON.parse(env.LLM_EXTRA_BODY) : undefined,
  },
  prompt,
  bars,
);
mkdirSync("out", { recursive: true });
const base = `out/${Date.now()}`;
writeFileSync(`${base}.mid`, midi);
writeFileSync(`${base}.json`, JSON.stringify(score, null, 2));
console.log(`OK: ${base}.mid (${score.tracks.length} tracks, ${Date.now() - t0}ms)`);
console.log("sections:", sections.map((s) => `${s.name}(${s.bars})`).join(" "));
console.log("stats:", JSON.stringify(stats));
