import { Hono } from "hono";
import { z } from "zod";
import { COMPLEXITIES } from "./plan";
import { compose } from "./compose";
import { describeLlmConfig, resolveLlmConfig } from "./llm/config";

/**
 * 環境変数 (wrangler.toml の [vars] / secret / ローカルの .dev.vars) で
 * AI プロバイダを切り替える。詳細は docs/llm-provider.md を参照。
 */
type Env = Record<string, string | undefined> & {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_PROVIDER?: string;
};

const Body = z.object({
  prompt: z.string().min(1).max(1000),
  bars: z.number().int().min(2).max(64).default(8),
  loop: z.boolean().default(false),
  ensemble: z.enum(["band", "orchestra"]).default("band"),
  seed: z.number().int().min(0).max(4294967295).nullish(),
  creativity: z.number().min(0).max(1).default(0.5),
  complexity: z.enum(COMPLEXITIES).default("standard"),
});

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/compose", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  let cfg;
  try {
    cfg = resolveLlmConfig(c.env);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "LLM config error" }, 500);
  }
  try {
    const result = await compose(
      cfg,
      parsed.data.prompt,
      parsed.data.bars,
      { loop: parsed.data.loop, ensemble: parsed.data.ensemble, seed: parsed.data.seed ?? undefined, creativity: parsed.data.creativity, complexity: parsed.data.complexity },
    );
    const { score, midi, sections, attempts, stats, harmony, issues, suggestions, complexity } = result;
    const explain = c.req.query("explain") === "1";
    return c.json({
      score, midi: toBase64(midi), sections, attempts, stats, complexity,
      ...(explain ? { harmony, issues, suggestions } : {}),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "compose failed" }, 502);
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));

/** 現在の AI 設定の要約 (APIキーは返さない)。UI・動作確認用 */
app.get("/api/config", (c) => {
  try {
    const summary = describeLlmConfig(resolveLlmConfig(c.env));
    return c.json(summary);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "LLM config error" }, 500);
  }
});

/** 利用可能なプロバイダ一覧 (設定画面用) */
app.get("/api/providers", async (c) => {
  const { PROVIDER_IDS, PROVIDER_PRESETS } = await import("./llm/config");
  return c.json(
    PROVIDER_IDS.map((id) => {
      const p = PROVIDER_PRESETS[id];
      return { id, label: p.label, defaultModel: p.defaultModel, baseUrl: p.baseUrl, auth: p.auth, notes: p.notes };
    }),
  );
});

export default app;
