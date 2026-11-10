import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthHeaders, buildChatUrl, chat, type LlmConfig } from "../src/llm/provider";

const baseCfg: LlmConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-test",
  apiKey: "sk-x",
  provider: "openai",
};

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchMock {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn as unknown as FetchMock;
}

const ok = (content: string, finish?: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish ?? "stop" }], usage: { prompt_tokens: 3 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("buildChatUrl / buildAuthHeaders", () => {
  it("uses /chat/completions by default and the configured path when set", () => {
    expect(buildChatUrl({ baseUrl: "https://api.openai.com/v1/" })).toBe("https://api.openai.com/v1/chat/completions");
    expect(buildChatUrl({ baseUrl: "https://x.openai.azure.com", path: "/openai/deployments/d/chat/completions?api-version=1" }))
      .toBe("https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=1");
  });

  it("supports bearer / api-key / none / custom header", () => {
    expect(buildAuthHeaders({ apiKey: "k", auth: "bearer" })).toEqual({ Authorization: "Bearer k" });
    expect(buildAuthHeaders({ apiKey: "k", auth: "api-key", apiKeyHeader: "api-key" })).toEqual({ "api-key": "k" });
    expect(buildAuthHeaders({ apiKey: "k", auth: "none" })).toEqual({});
    expect(buildAuthHeaders({ apiKey: "k", auth: "header", apiKeyHeader: "X-Token" })).toEqual({ "X-Token": "k" });
  });
});

describe("chat", () => {
  it("sends an OpenAI-compatible request with json mode", async () => {
    const fetchMock = mockFetch(() => ok('{"title":"t"}'));
    const result = await chat(baseCfg, [{ role: "user", content: "hi" }], { temperature: 0.3 });
    expect(result.content).toBe('{"title":"t"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-test");
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-x");
  });

  it("honours Azure-style path, auth header and extra body/headers", async () => {
    const fetchMock = mockFetch(() => ok("{}"));
    const cfg: LlmConfig = {
      ...baseCfg,
      baseUrl: "https://example.openai.azure.com",
      path: "/openai/deployments/dep/chat/completions?api-version=2024-10-21",
      auth: "api-key",
      apiKeyHeader: "api-key",
      headers: { "X-Custom": "1" },
      extraBody: { thinking: { type: "disabled" } },
      bodyDefaults: { seed: 7 },
      jsonMode: false,
    };
    await chat(cfg, [{ role: "user", content: "hi" }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.openai.azure.com/openai/deployments/dep/chat/completions?api-version=2024-10-21");
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("sk-x");
    expect(headers["X-Custom"]).toBe("1");
    expect(headers["Authorization"]).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toBeUndefined();
    expect(body.seed).toBe(7);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("retries on 429 and respects Retry-After", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      if (calls === 1) {
        return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
      }
      return ok("{}");
    });
    const result = await chat({ ...baseCfg, maxRetries: 2 }, [{ role: "user", content: "hi" }]);
    expect(result.content).toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast on 400 without retrying", async () => {
    const fetchMock = mockFetch(() => new Response("bad request", { status: 400 }));
    await expect(chat({ ...baseCfg, maxRetries: 3 }, [{ role: "user", content: "hi" }]))
      .rejects.toThrow(/LLM request failed\[openai:gpt-test\]: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses content given as parts and reports empty content with reason", async () => {
    mockFetch(() => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const res = await chat(baseCfg, [{ role: "user", content: "hi" }]);
    expect(res.content).toBe("hello world");

    mockFetch(() => new Response(JSON.stringify({
      choices: [{ message: { content: "" }, finish_reason: "length" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(chat(baseCfg, [{ role: "user", content: "hi" }])).rejects.toThrow(/finish_reason=length.*LLM_MAX_TOKENS/);
  });

  it("includes the provider/model in errors", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "model not found" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await expect(chat(baseCfg, [{ role: "user", content: "hi" }])).rejects.toThrow(/LLM error\[openai:gpt-test\]: model not found/);
  });
});
