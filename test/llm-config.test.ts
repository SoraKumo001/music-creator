import { describe, expect, it } from "vitest";
import { describeLlmConfig, PROVIDER_IDS, resolveLlmConfig } from "../src/llm/config";

const key = { LLM_API_KEY: "sk-test" };

describe("resolveLlmConfig", () => {
  it("resolves the OpenAI preset", () => {
    const cfg = resolveLlmConfig({ ...key, LLM_PROVIDER: "openai" });
    expect(cfg.baseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.auth).toBe("bearer");
    expect(cfg.jsonMode).toBe(true);
    expect(cfg.path).toBeUndefined();
  });

  it("builds the Azure deployment path and api-key header", () => {
    const cfg = resolveLlmConfig({
      LLM_PROVIDER: "azure",
      LLM_API_KEY: "az-key",
      LLM_BASE_URL: "https://example.openai.azure.com",
      LLM_MODEL: "my-deploy",
      LLM_API_VERSION: "2024-10-21",
    });
    expect(cfg.path).toBe("/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21");
    expect(cfg.auth).toBe("api-key");
    expect(cfg.apiKeyHeader).toBe("api-key");
  });

  it("allows local providers with no API key", () => {
    const cfg = resolveLlmConfig({ LLM_PROVIDER: "ollama" });
    expect(cfg.apiKey).toBe("");
    expect(cfg.jsonMode).toBe(false);
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("applies overrides for baseUrl/model/timeouts/body/headers", () => {
    const cfg = resolveLlmConfig({
      ...key,
      LLM_PROVIDER: "custom",
      LLM_BASE_URL: "https://example.com/v1/",
      LLM_MODEL: "my-model",
      LLM_TEMPERATURE: "0.4",
      LLM_MAX_TOKENS: "2048",
      LLM_TIMEOUT_MS: "15000",
      LLM_MAX_RETRIES: "5",
      LLM_JSON_MODE: "false",
      LLM_EXTRA_BODY: '{"thinking":{"type":"disabled"}}',
      LLM_EXTRA_HEADERS: '{"X-Custom":"1"}',
    });
    expect(cfg.baseUrl).toBe("https://example.com/v1"); // 末尾スラッシュ除去
    expect(cfg.model).toBe("my-model");
    expect(cfg.temperature).toBe(0.4);
    expect(cfg.maxTokens).toBe(2048);
    expect(cfg.timeoutMs).toBe(15000);
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.jsonMode).toBe(false);
    expect(cfg.extraBody).toEqual({ thinking: { type: "disabled" } });
    expect(cfg.headers).toEqual({ "X-Custom": "1" });
  });

  it("keeps provider-specific defaults (low temp thinking body for opencode)", () => {
    const cfg = resolveLlmConfig({ ...key, LLM_PROVIDER: "opencode" });
    expect(cfg.bodyDefaults).toEqual({ thinking: { type: "disabled" } });
    expect(cfg.model).toBe("deepseek-v4.1-flash");
  });

  it("rejects unknown providers and missing keys with clear errors", () => {
    expect(() => resolveLlmConfig({ ...key, LLM_PROVIDER: "nope" })).toThrow(/unknown LLM_PROVIDER/);
    expect(() => resolveLlmConfig({ LLM_PROVIDER: "openai" })).toThrow(/LLM_API_KEY is required/);
    expect(() => resolveLlmConfig({ ...key, LLM_BASE_URL: "not a url at all" })).not.toThrow();
    expect(() => resolveLlmConfig({ ...key, LLM_JSON_MODE: "maybe" })).toThrow(/invalid boolean/);
    expect(() => resolveLlmConfig({ ...key, LLM_EXTRA_BODY: "[1,2]" })).toThrow(/must be a JSON object/);
  });

  it("exposes every preset with a label and model", () => {
    for (const id of PROVIDER_IDS) {
      const cfg = resolveLlmConfig({
        LLM_PROVIDER: id,
        LLM_API_KEY: id === "ollama" ? "" : "k",
        LLM_BASE_URL: id === "azure" || id === "custom" ? "https://example.com/v1" : undefined,
      });
      const summary = describeLlmConfig(cfg);
      expect(summary.provider).toBe(id);
      expect(summary.label.length).toBeGreaterThan(0);
      expect(summary.model.length).toBeGreaterThan(0);
    }
  });
});

describe("describeLlmConfig", () => {
  it("never exposes the API key", () => {
    const cfg = resolveLlmConfig({ ...key, LLM_PROVIDER: "openai" });
    const summary = describeLlmConfig(cfg);
    expect(JSON.stringify(summary)).not.toContain("sk-test");
    expect(summary.hasApiKey).toBe(true);
    expect(summary.baseHost).toBe("api.openai.com");
  });
});
