export type LlmConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** プロバイダ識別子 (ログ・エラー表示用) */
  provider?: string;
  userAgent?: string;
  /** 会話ごとに安定したID(x-opencode-session)。未指定なら呼び出しごとに生成 */
  sessionId?: string;
  /** リクエストbodyへ追加で混ぜるパラメータ(推論無効化の実験など)。最後にマージされる */
  extraBody?: Record<string, unknown>;
  /** プロバイダ固有のbody既定値 (プリセット由来)。extraBody より弱い */
  bodyDefaults?: Record<string, unknown>;
  /** 追加ヘッダー */
  headers?: Record<string, string>;
  /** 認証方式 */
  auth?: "bearer" | "api-key" | "none" | "header";
  /** auth=api-key/header のときのヘッダー名 */
  apiKeyHeader?: string;
  /** chat/completions のパス上書き (Azure など) */
  path?: string;
  /** response_format: json_object を送るか (既定 true) */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type ChatResult = { content: string; usage?: Usage; ms: number };

export type ChatOptions = { temperature?: number; signal?: AbortSignal };

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** リクエスト先URL。path 指定時はそれを優先 (クエリ込み) */
export function buildChatUrl(cfg: Pick<LlmConfig, "baseUrl" | "path">): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.path) {
    if (cfg.path.startsWith("http://") || cfg.path.startsWith("https://")) return cfg.path;
    return base + (cfg.path.startsWith("/") ? "" : "/") + cfg.path;
  }
  return `${base}/chat/completions`;
}

/** 認証まわりのヘッダー */
export function buildAuthHeaders(cfg: Pick<LlmConfig, "apiKey" | "auth" | "apiKeyHeader">): Record<string, string> {
  const auth = cfg.auth ?? "bearer";
  if (auth === "none") return {};
  if (auth === "api-key") return { [cfg.apiKeyHeader ?? "api-key"]: cfg.apiKey };
  if (auth === "header") return { [cfg.apiKeyHeader ?? "Authorization"]: cfg.apiKey };
  return { Authorization: `Bearer ${cfg.apiKey}` };
}

/** レスポンスの content を文字列へ (配列パーツ形式にも対応) */
function extractContent(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown; refusal?: unknown };
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as { text?: unknown; content?: unknown };
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .join("");
  }
  if (m.content && typeof m.content === "object") {
    const c = m.content as { text?: unknown };
    if (typeof c.text === "string") return c.text;
  }
  return "";
}

function snippet(text: string, max = 400): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 10_000));
  return null;
}

/**
 * OpenAI 互換 chat/completions を叩く薄い層。
 * - 認証方式・パス・追加ヘッダーを設定で切り替えられる (OpenAI / Azure / OpenRouter / ローカル等)
 * - 429/5xx は指数バックオフでリトライ
 * - タイムアウト付き
 */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const t0 = Date.now();
  const url = buildChatUrl(cfg);
  const maxRetries = Math.max(0, cfg.maxRetries ?? 2);
  const timeoutMs = Math.max(1000, cfg.timeoutMs ?? 60_000);
  const label = cfg.provider ? `[${cfg.provider}:${cfg.model}]` : `[${cfg.model}]`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": cfg.userAgent ?? "music-creator/0.1",
    ...buildAuthHeaders(cfg),
    ...(cfg.headers ?? {}),
  };
  if (cfg.sessionId && !("x-opencode-session" in headers)) {
    headers["x-opencode-session"] = cfg.sessionId;
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature ?? 0.8,
    ...(cfg.maxTokens !== undefined ? { max_tokens: cfg.maxTokens } : {}),
    ...(cfg.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
    ...(cfg.bodyDefaults ?? {}),
    ...(cfg.extraBody ?? {}),
  };

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 呼び出し側の signal とタイムアウトを合成する
    const controller = new AbortController();
    const onAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `LLM request failed${label}: ${res.status} ${snippet(text)}`;
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
          await sleep(retryAfterMs(res) ?? Math.min(4000, 300 * 2 ** attempt));
          continue;
        }
        throw new Error(lastError);
      }

      const data = (await res.json()) as {
        choices?: { message?: unknown; finish_reason?: string }[];
        usage?: Usage;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`LLM error${label}: ${snippet(data.error.message)}`);

      const content = extractContent(data.choices?.[0]?.message);
      if (!content) {
        const finish = data.choices?.[0]?.finish_reason ?? "unknown";
        throw new Error(
          `LLM returned empty content${label} (finish_reason=${finish})` +
          (finish === "length" ? " — increase LLM_MAX_TOKENS or reduce the requested bars" : ""),
        );
      }
      return { content, usage: data.usage, ms: Date.now() - t0 };
    } catch (e) {
      // リトライ可能なネットワーク/タイムアウト
      const aborted = controller.signal.aborted;
      const reason = aborted ? (controller.signal.reason ?? e) : e;
      lastError = reason instanceof Error ? reason.message : String(reason);
      if (attempt < maxRetries && (aborted || e instanceof TypeError)) {
        await sleep(Math.min(4000, 300 * 2 ** attempt));
        continue;
      }
      throw new Error(`LLM request failed${label}: ${lastError}`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new Error(`LLM request failed${label}: ${lastError}`);
}
