# AI プロバイダ設定（OpenAI 互換 API）

このアプリの AI 呼び出しは **OpenAI 互換の `chat/completions`** だけを使う。
接続先は環境変数だけで切り替えられるので、コード変更なしで
OpenAI 本家・Azure OpenAI・OpenRouter・Groq・DeepSeek・ローカル LLM などへ移行できる。

## 1. 最短の設定

`.dev.vars`（ローカル）または `wrangler secret put` / `[vars]`（本番）に設定する。

```dotenv
# OpenAI 本家
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

```bash
npm run dev          # ローカル開発
npm run compose -- "静かなローファイ" 8   # CLIから疎通確認
```

`http://<host>/api/config` で現在の設定（キー以外）を確認できる。

## 2. プリセット

| `LLM_PROVIDER` | 接続先 | 既定モデル | 認証 |
|---|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` | `Authorization: Bearer` |
| `azure` | `LLM_BASE_URL` (`https://<resource>.openai.azure.com`) | デプロイメント名 | `api-key` ヘッダー |
| `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | Bearer |
| `groq` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Bearer |
| `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` | Bearer |
| `ollama` | `http://localhost:11434/v1` | `llama3.1` | なし（キー不要） |
| `opencode` | `https://opencode.ai/inference/go/openai/v1` | `deepseek-v4.1-flash` | Bearer（既定） |
| `custom` | `LLM_BASE_URL` 必須 | 任意 | Bearer |

Azure の場合は次の3つを設定する。

```dotenv
LLM_PROVIDER=azure
LLM_BASE_URL=https://<resource>.openai.azure.com
LLM_MODEL=<デプロイメント名>
LLM_API_KEY=<Azureのキー>
#LLM_API_VERSION=2024-10-21
```

Azure のパスは自動で
`/openai/deployments/<LLM_MODEL>/chat/completions?api-version=...` になる。

## 3. 環境変数一覧

| 変数 | 既定 | 説明 |
|---|---|---|
| `LLM_PROVIDER` | `opencode` | 上表のプリセット |
| `LLM_API_KEY` | — | APIキー（`ollama` では不要） |
| `LLM_BASE_URL` | プリセット | ベースURLの上書き（末尾スラッシュは自動除去） |
| `LLM_MODEL` | プリセット | モデル名（Azure はデプロイメント名） |
| `LLM_API_VERSION` | プリセット | Azure の `api-version` |
| `LLM_AUTH_STYLE` | プリセット | `bearer` / `api-key` / `none` / `header` |
| `LLM_API_KEY_HEADER` | プリセット | 認証ヘッダー名（`header` 指定時は必須） |
| `LLM_EXTRA_HEADERS` | — | 追加ヘッダーの JSON |
| `LLM_EXTRA_BODY` | プリセット | リクエストbodyへ混ぜる JSON（`LLM_BODY` も可） |
| `LLM_JSON_MODE` | プリセット | `true` で `response_format: json_object` を送る |
| `LLM_TEMPERATURE` | `0.8` | 既定 temperature（0–2） |
| `LLM_MAX_TOKENS` | — | 既定 max_tokens |
| `LLM_TIMEOUT_MS` | `60000` | 1リクエストのタイムアウト |
| `LLM_MAX_RETRIES` | `2` | 429/5xx/タイムアウト時のリトライ回数 |
| `LLM_USER_AGENT` | `music-creator/0.1` | User-Agent |

`LLM_EXTRA_BODY` は `response_format` より後にマージされるため、プロバイダ固有の
パラメータで上書きできる。既定の `opencode` では `{"thinking":{"type":"disabled"}}` が
プリセットに含まれている（OpenAI 等へ切り替えるときは `LLM_EXTRA_BODY={}` を推奨）。

## 4. 挙動

- **タイムアウト**: `LLM_TIMEOUT_MS`。呼び出し側の `AbortSignal` とも合成される
- **リトライ**: 408/409/425/429/500/502/503/504 とネットワーク失敗時に指数バックオフ
  （`Retry-After` ヘッダーがあれば優先。最大10秒）
- **JSONモード無効化**: `LLM_JSON_MODE=false`（Ollama の一部モデルや、JSONモード非対応の
  サーバー向け）。プロンプト側はJSON出力を要求するので、モデルが従う必要がある
- **エラー表示**: `[provider:model] ステータス 本文冒頭` の形式で返る
- **content 形式**: 文字列のほか、`[{type:"text",text:...}]` のパーツ配列にも対応
- **空レスポンス**: `finish_reason=length` の場合は `LLM_MAX_TOKENS` の増加を促すメッセージを返す

## 5. 動作確認

```bash
# 設定の確認 (APIキーは含まれない)
curl http://127.0.0.1:8787/api/config

# プロバイダ一覧
curl http://127.0.0.1:8787/api/providers

# 実際に1曲生成
npm run compose -- "明るいポップ" 8 --complexity=standard
```

UI には現在の `AI: <プロバイダ> / <モデル>` が表示される（`/api/config` 由来）。

## 6. 本番デプロイ

本番のシークレットは **`.dev.vars.production`** に置く（`.gitignore` 済み）。
`wrangler deploy --secrets-file` がこのファイルを読み、シークレットとして
アップロードしつつデプロイする。

```bash
npm run deploy        # wrangler deploy --secrets-file .dev.vars.production
npm run deploy:dry    # アップロードせずビルド検証
npm run deploy:plain  # シークレットを送らない通常デプロイ
```

`.dev.vars.production`（本番用）:

```dotenv
LLM_API_KEY=sk-...
# 必要なら wrangler.toml の [vars] を上書き
#LLM_MODEL=gpt-4o-mini
```

- プロバイダ・モデル・タイムアウトなどは `wrangler.toml` の `[vars]` が既定
- `.dev.vars.production` に書いたキーはすべて**シークレットとして**送られる。
  `[vars]` と同じ名前を書くと衝突するので、上書きしたい変数は `--var` を使うか、
  `[env.production.vars]` で環境を分ける
- 環境を分ける場合は `wrangler deploy --env production --secrets-file .dev.vars.production`
  のように `--env` を付ける（`[env.production]` が必要）

環境ごとの設定例:

```toml
[env.production.vars]
LLM_PROVIDER = "openai"
LLM_MODEL = "gpt-4o-mini"
LLM_BASE_URL = "https://api.openai.com/v1"
LLM_EXTRA_BODY = ""
```

```bash
wrangler deploy --env production --secrets-file .dev.vars.production
wrangler secret list --env production
```

## 7. 実装ファイル

| ファイル | 役割 |
|---|---|
| `src/llm/config.ts` | 環境変数 → `LlmConfig` の解決、プリセット、安全な要約 |
| `src/llm/provider.ts` | OpenAI互換リクエスト（認証・パス・リトライ・タイムアウト・解析） |
| `src/index.ts` | `/api/compose`・`/api/config`・`/api/providers` |
| `scripts/_llm.ts` | CLI用の `.dev.vars` 読み込み + 設定解決 |
| `test/llm-config.test.ts` | プリセット・上書き・エラー処理 |
| `test/llm-provider.test.ts` | リクエスト生成・Azure・リトライ・エラー処理 |

## 8. 制限

- OpenAI 互換でない API（Anthropic Messages API など）はそのままでは使えない。
  必要なら互換ゲートウェイ（LiteLLM 等）を `custom` で指す。
- ストリーミングは未対応（1回のレスポンスを待つ）。
- ツール呼び出し・画像入力は未対応。
