import { describe, expect, it } from "vitest";
import app from "../src/index";

const env = {
  LLM_PROVIDER: "openai",
  LLM_API_KEY: "sk-secret",
  LLM_MODEL: "gpt-4o-mini",
};

describe("/api/config", () => {
  it("returns the resolved provider without leaking the API key", async () => {
    const res = await app.request("/api/config", undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("reports missing configuration as an error", async () => {
    const res = await app.request("/api/config", undefined, {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/LLM_API_KEY/);
  });
});

describe("/api/providers", () => {
  it("lists every preset without secrets", async () => {
    const res = await app.request("/api/providers", undefined, env);
    expect(res.status).toBe(200);
    const list = (await res.json()) as { id: string; label: string; defaultModel: string }[];
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(["openai", "azure", "ollama", "custom"]));
    for (const p of list) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });
});

describe("/api/health", () => {
  it("returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("/api/compose body validation", () => {
  it("rejects a non-boolean webKnowledge before calling the LLM", async () => {
    const res = await app.request(
      "/api/compose",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "test", webKnowledge: "yes" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a boolean webKnowledge (fails later at the LLM layer, not at validation)", async () => {
    // 無効な llm 設定にして compose 前に 500 を返させる (body 検証は通過している)
    const res = await app.request(
      "/api/compose",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "test", webKnowledge: false }),
      },
      {},
    );
    expect(res.status).toBe(500);
  });
});

describe("OGP injection", () => {
  const html = `<!doctype html><html><head>
<link rel="canonical" href="/">
<meta property="og:url" content="/">
<meta property="og:image" content="/ogp.png">
<meta name="twitter:image" content="/ogp.png">
</head><body></body></html>`;

  const assets = {
    fetch: async () => new Response(html, { headers: { "Content-Type": "text/html" } }),
  };

  it("rewrites relative OGP URLs to absolute ones based on the request origin", async () => {
    const res = await app.request("https://example.com/", undefined, { ASSETS: assets } as never);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<link rel="canonical" href="https://example.com/">');
    expect(body).toContain('<meta property="og:url" content="https://example.com/">');
    expect(body).toContain('content="https://example.com/ogp.png"');
    // 相対URLが残っていない
    expect(body).not.toContain('content="/ogp.png"');
    expect((res.headers.get("Content-Type") ?? "")).toContain("text/html");
  });

  it("serves index.html for /index.html too", async () => {
    const res = await app.request("http://127.0.0.1:8788/index.html", undefined, { ASSETS: assets } as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("http://127.0.0.1:8788/ogp.png");
  });

  it("returns 404 when the assets binding is missing", async () => {
    const res = await app.request("/", undefined, {});
    expect(res.status).toBe(404);
  });
});

