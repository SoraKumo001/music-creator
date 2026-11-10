/**
 * LLM (OpenAI 互換 API) の設定解決。
 *
 * 環境変数からプロバイダ・モデル・認証方式・リクエスト先を決める。
 * Workers / Node のどちらでも動く純粋関数のみ (ファイル読み込みは scripts 側)。
 *
 * 主な環境変数:
 *   LLM_PROVIDER        openai | azure | openrouter | groq | deepseek | ollama | opencode | custom
 *   LLM_API_KEY         APIキー (ollama など不要な場合は空でよい)
 *   LLM_BASE_URL        ベースURL (指定するとプリセットを上書き)
 *   LLM_MODEL           モデル名 (Azure ではデプロイメント名)
 *   LLM_API_VERSION     Azure の api-version
 *   LLM_AUTH_STYLE      bearer | api-key | none | header
 *   LLM_API_KEY_HEADER  認証ヘッダー名 (既定: Authorization / api-key)
 *   LLM_EXTRA_HEADERS   追加ヘッダーの JSON
 *   LLM_EXTRA_BODY      リクエストbodyへ混ぜる JSON (旧名。LLM_BODY も可)
 *   LLM_JSON_MODE       true/false (response_format: json_object を送るか)
 *   LLM_TEMPERATURE     既定 temperature
 *   LLM_MAX_TOKENS      既定 max_tokens
 *   LLM_TIMEOUT_MS      1リクエストのタイムアウト
 *   LLM_MAX_RETRIES     リトライ回数
 *   LLM_USER_AGENT      User-Agent
 */

import type { LlmConfig } from "./provider";

export type ProviderId =
  | "openai"
  | "azure"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "ollama"
  | "opencode"
  | "custom";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  /** 既定ベースURL (azure / custom は必須入力) */
  baseUrl?: string;
  defaultModel: string;
  auth: "bearer" | "api-key" | "none" | "header";
  apiKeyHeader?: string;
  /** Azure の場合のデフォルト api-version */
  defaultApiVersion?: string;
  /** response_format を既定で送るか */
  jsonMode: boolean;
  /** リクエストbodyへ既定で混ぜる値 (プロバイダ固有の拡張) */
  bodyDefaults?: Record<string, unknown>;
  /** 追加の既定ヘッダー */
  headers?: Record<string, string>;
  notes?: string;
};

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    auth: "bearer",
    jsonMode: true,
  },
  azure: {
    id: "azure",
    label: "Azure OpenAI",
    defaultModel: "gpt-4o-mini",
    auth: "api-key",
    apiKeyHeader: "api-key",
    defaultApiVersion: "2024-10-21",
    jsonMode: true,
    notes: "LLM_BASE_URL=https://<resource>.openai.azure.com, LLM_MODEL=デプロイメント名",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    auth: "bearer",
    jsonMode: true,
    headers: { "HTTP-Referer": "https://localhost", "X-Title": "music-creator" },
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    auth: "bearer",
    jsonMode: true,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    auth: "bearer",
    jsonMode: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama (ローカル)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    auth: "none",
    jsonMode: false,
    notes: "ローカル実行。APIキー不要",
  },
  opencode: {
    id: "opencode",
    label: "opencode.ai (既定)",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    defaultModel: "deepseek-v4.1-flash",
    auth: "bearer",
    jsonMode: true,
    // 推論(thinking)を無効化すると約10倍速い。品質重視なら LLM_EXTRA_BODY='{}' で無効化
    bodyDefaults: { thinking: { type: "disabled" } },
  },
  custom: {
    id: "custom",
    label: "OpenAI互換 (任意)",
    defaultModel: "gpt-4o-mini",
    auth: "bearer",
    jsonMode: true,
    notes: "LLM_BASE_URL に /v1 までのベースURLを指定",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[];

export type LlmConfigSummary = {
  provider: ProviderId;
  label: string;
  model: string;
  /** ベースURLのホスト部分のみ (キーやクエリは出さない) */
  baseHost: string;
  auth: string;
  jsonMode: boolean;
  timeoutMs: number;
  maxRetries: number;
  hasApiKey: boolean;
  notes?: string;
};

const parseJsonObject = (raw: string | undefined, name: string): Record<string, unknown> | undefined => {
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`invalid boolean: ${raw}`);
};

const parsePositiveInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.round(n);
};

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, "");

/** 環境変数から LlmConfig を作る */
export function resolveLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const providerRaw = (env.LLM_PROVIDER ?? "opencode").trim().toLowerCase();
  if (!PROVIDER_IDS.includes(providerRaw as ProviderId)) {
    throw new Error(`unknown LLM_PROVIDER "${providerRaw}". Use one of: ${PROVIDER_IDS.join(", ")}`);
  }
  const provider = providerRaw as ProviderId;
  const preset = PROVIDER_PRESETS[provider];

  const baseInput = env.LLM_BASE_URL?.trim() || preset.baseUrl;
  if (!baseInput) throw new Error(`LLM_BASE_URL is required for provider "${provider}"`);
  const baseUrl = stripTrailingSlash(baseInput);
  const model = env.LLM_MODEL?.trim() || preset.defaultModel;
  const apiKey = env.LLM_API_KEY?.trim() ?? "";

  const authStyle = (env.LLM_AUTH_STYLE?.trim().toLowerCase() || preset.auth) as LlmConfig["auth"];
  if (!["bearer", "api-key", "none", "header"].includes(authStyle ?? "")) {
    throw new Error(`invalid LLM_AUTH_STYLE "${env.LLM_AUTH_STYLE}"`);
  }
  if (authStyle !== "none" && authStyle !== "header" && apiKey === "") {
    throw new Error(`LLM_API_KEY is required for provider "${provider}"`);
  }
  if (authStyle === "header" && !env.LLM_API_KEY_HEADER) {
    throw new Error("LLM_API_KEY_HEADER is required when LLM_AUTH_STYLE=header");
  }

  const extraHeaders = parseJsonObject(env.LLM_EXTRA_HEADERS, "LLM_EXTRA_HEADERS");
  const extraHeaderStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraHeaders ?? {})) {
    if (typeof v === "string") extraHeaderStrings[k] = v;
  }
  const extraBody = parseJsonObject(env.LLM_EXTRA_BODY ?? env.LLM_BODY, "LLM_EXTRA_BODY");
  const jsonMode = parseBool(env.LLM_JSON_MODE, preset.jsonMode);
  const timeoutMs = parsePositiveInt(env.LLM_TIMEOUT_MS, 60_000, "LLM_TIMEOUT_MS");
  const maxRetries = parsePositiveInt(env.LLM_MAX_RETRIES, 2, "LLM_MAX_RETRIES");
  const maxTokens = env.LLM_MAX_TOKENS?.trim() ? parsePositiveInt(env.LLM_MAX_TOKENS, 0, "LLM_MAX_TOKENS") : undefined;
  const temperature = env.LLM_TEMPERATURE?.trim() ? Number(env.LLM_TEMPERATURE) : undefined;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    throw new Error(`LLM_TEMPERATURE must be between 0 and 2`);
  }

  const headers: Record<string, string> = { ...(preset.headers ?? {}), ...extraHeaderStrings };
  const apiKeyHeader = env.LLM_API_KEY_HEADER?.trim() || preset.apiKeyHeader;

  // Azure はパスが特殊: /openai/deployments/{model}/chat/completions?api-version=...
  const apiVersion = env.LLM_API_VERSION?.trim() || preset.defaultApiVersion;
  const path = provider === "azure"
    ? `/openai/deployments/${encodeURIComponent(model)}/chat/completions${apiVersion ? `?api-version=${encodeURIComponent(apiVersion)}` : ""}`
    : undefined;

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    auth: authStyle,
    apiKeyHeader,
    path,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    jsonMode,
    timeoutMs,
    maxRetries,
    maxTokens,
    temperature,
    userAgent: env.LLM_USER_AGENT?.trim() || "music-creator/0.1",
    bodyDefaults: preset.bodyDefaults,
    extraBody,
  };
}

/** 設定の安全な要約 (APIキーを含めない) */
export function describeLlmConfig(cfg: LlmConfig): LlmConfigSummary {
  const provider = (cfg.provider ?? "custom") as ProviderId;
  const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.custom;
  let baseHost = "";
  try {
    baseHost = new URL(cfg.baseUrl).host;
  } catch {
    baseHost = cfg.baseUrl.split("/")[0] ?? "";
  }
  return {
    provider,
    label: preset.label,
    model: cfg.model,
    baseHost,
    auth: cfg.auth ?? preset.auth,
    jsonMode: cfg.jsonMode ?? preset.jsonMode,
    timeoutMs: cfg.timeoutMs ?? 60_000,
    maxRetries: cfg.maxRetries ?? 2,
    hasApiKey: cfg.apiKey !== "",
    notes: preset.notes,
  };
}

