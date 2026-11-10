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
