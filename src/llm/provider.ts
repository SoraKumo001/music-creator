export type LlmConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  userAgent?: string;
  /** 会話ごとに安定したID(x-opencode-session)。未指定なら呼び出しごとに生成 */
  sessionId?: string;
  /** リクエストbodyへ追加で混ぜるパラメータ(推論無効化の実験など) */
  extraBody?: Record<string, unknown>;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type ChatResult = { content: string; usage?: Usage; ms: number };

/** OpenAI互換 chat/completions を叩く薄い層。プロバイダ差し替えは baseUrl/model/apiKey のみ */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: { temperature?: number; signal?: AbortSignal } = {}): Promise<ChatResult> {
  const t0 = Date.now();
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "User-Agent": cfg.userAgent ?? "music-creator/0.1",
      "x-opencode-session": cfg.sessionId ?? "mc-" + crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? 0.8,
      response_format: { type: "json_object" },
      ...cfg.extraBody,
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: Usage;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return { content, usage: data.usage, ms: Date.now() - t0 };
}
