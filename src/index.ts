import { Hono } from "hono";
import { z } from "zod";
import { COMPLEXITIES } from "./plan";
import { compose } from "./compose";

type Env = { LLM_API_KEY: string; LLM_BASE_URL: string; LLM_MODEL: string; LLM_EXTRA_BODY?: string };

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
  try {
    const result = await compose(
      { baseUrl: c.env.LLM_BASE_URL, model: c.env.LLM_MODEL, apiKey: c.env.LLM_API_KEY,
        extraBody: c.env.LLM_EXTRA_BODY ? JSON.parse(c.env.LLM_EXTRA_BODY) : undefined },
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

export default app;
