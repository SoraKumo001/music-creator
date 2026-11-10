/**
 * スクリプト共通の LLM 設定ローダ。
 * .dev.vars (なければ環境変数のみ) を読み、src/llm/config.ts の解決関数に渡す。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveLlmConfig } from "../src/llm/config";
import type { LlmConfig } from "../src/llm/provider";

/** .dev.vars を読み込んで環境変数へマージ (既存の環境変数は優先) */
export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let value = (m[2] ?? "").trim();
      // クォートされていれば外す
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[m[1]!] = value;
    }
  }
  // 実環境変数が優先
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && k.startsWith("LLM_")) env[k] = v;
  }
  return env;
}

/** スクリプト用: 設定を解決し、失敗時は分かりやすいメッセージで落とす */
export function requireLlmConfig(): LlmConfig {
  const env = loadEnv();
  try {
    return resolveLlmConfig(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg}\n環境変数 (または .dev.vars) を設定してください。例:\n` +
      "  LLM_PROVIDER=openai\n  LLM_API_KEY=sk-...\n  LLM_MODEL=gpt-4o-mini\n" +
      "詳細は docs/llm-provider.md を参照。",
    );
  }
}
