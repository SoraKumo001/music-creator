# MIDI コーパス解析による生成改善パイプライン

## 0. 位置づけと制約

このパイプラインは「**解析 → 統計プロファイル → 生成プロンプト → 適合度測定 → 調整**」のループを
リポジトリ内で再現可能にするための構造です。

**データ利用の制約（重要）**

- 本パイプラインは **集計統計のみ** を扱います。旋律・譜面・MIDI ファイルそのものは
  リポジトリに含めず、生成物にも一切転記しません。
- 取得した MIDI は `out/corpus/`（gitignore 済み）にキャッシュするだけです。
- 生成される曲は「統計的傾向（テンポ帯・楽器構成・リズムの細分性・和音品質の分布など）」だけを参照します。
  特定曲のフレーズや進行を再現する用途には使えません（使わないでください）。
- 取得時はレート制限（既定 700ms 間隔）と識別可能な User-Agent を付けています。

## 1. 全体像

```
参照ページ HTML
   │  ① 取得 (scripts/analyze-corpus.ts, --url)
   ▼
out/corpus/*.mid           … ローカルキャッシュ (再配布しない)
   │  ② 解析 (src/midi/parseMidi.ts → src/analyze/features.ts)
   ▼
out/corpus-features.json   … 1曲ごとの特徴 (検査用)
   │  ③ 集計 (src/analyze/corpus.ts)
   ▼
out/corpus-profile.json    … 集計プロファイル
out/corpus-report.md       … 人向けレポート
src/knowledge/corpus-profile.generated.ts  … 生成側が import する成果物
   │  ④ プロンプト注入 (src/knowledge/corpus.ts → src/prompt.ts)
   ▼
compose() による生成
   │  ⑤ 適合度測定 (src/eval/corpusFit.ts, scripts/eval-corpus-fit.ts)
   ▼
指標が下がった項目を ②③④（重み・知見・ルール）へフィードバック
```

ポイントは ③ の出力を **TypeScript モジュールとして生成** することです。
アプリは Cloudflare Workers 上で動くため実行時にファイルを読めませんが、
静的に import すればバンドルに含まれてそのまま使えます。

## 2. 使い方

```bash
# 参照ページから取得して解析・集計 (既定 30 件)
npm run analyze:corpus -- --url https://example.com --limit 40

# すでにキャッシュ済みの MIDI だけを再集計 (ネットワーク不要)
npm run analyze:corpus -- --dir out/corpus --no-fetch --label my-corpus

# 適合度の測定 (保存済みフィクスチャ。ネットワーク不要)
npm run eval:corpus-fit

# 実際に生成して測定 (要 .dev.vars の LLM_API_KEY)
npm run eval:corpus-fit -- --live --bars=16 --prompts="疾走感のあるロック|静かなローファイ"
```

主なオプション:

| オプション | 既定 | 意味 |
|---|---|---|
| `--url` | — | 一覧ページの URL（`href="*.mid"` を抽出） |
| `--dir` | `out/corpus` | ローカルの MIDI ディレクトリ / キャッシュ先 |
| `--limit` | 30 | 取得する最大件数 |
| `--delay` | 800 | 取得間隔 ms |
| `--no-fetch` | false | 取得をスキップしてローカル解析のみ |
| `--label` | `midi-corpus` | レポートに載るコーパス名 |
| `--out` | `out/corpus-profile.json` | プロファイル JSON |
| `--generated` | `src/knowledge/corpus-profile.generated.ts` | 生成側が読む TS モジュール |
| `--report` | `out/corpus-report.md` | Markdown レポート |
| `--features` | `out/corpus-features.json` | 1曲ごとの特徴 |

## 3. 解析している内容

`src/midi/parseMidi.ts`（依存なし SMF パーサー）

- format 0 / 1、ランニングステータス、テンポマップ、拍子、音色チェンジ
- ノートは tick と秒の両方を持つ（拍節は tick 基準で扱う）

`src/analyze/features.ts`（1曲の特徴）

| 分類 | 内容 |
|---|---|
| 基本 | 長さ、テンポ（最長区間を代表値 / 有意区間の範囲）、拍子、小節数、キー（Krumhansl 相関） |
| 楽器 | GM 音色の出現数、楽器ファミリー比率、ドラム GM 番号の出現数 |
| リズム | 小節内 16 ステップのオンセット分布、音価分布、ダウンビート/裏8分/16分の比率、グリッド外の比率 |
| 和声 | 小節ごとのコード推定（テンプレート照合 + ベース音 + 構成音の充足度）、ローマ数字、品質分布、借用率、2連の頻度 |
| 旋律 | 最高声部の抽出、音程ヒストグラム、音域、1小節あたり音符数 |
| 構成 | 小節クロマの変化点からセクション境界を推定し、セクション長を返す |

**拍節の実測推定**（この種の MIDI 特有の事情）

参照先の MIDI は `division = 120` と宣言しつつ、実際のノートは 1/96 音符相当の格子で
打ち込まれていたり、テンポメタデータが全曲 `800 → 125 BPM` という書き出し規約になっています。
そのため小節長は宣言値ではなく、**オンセットの自己相関**から推定し（`inferBarTicks`）、
宣言値と明確に違う場合だけ採用します。推定したかどうかは `barInference` / `barConfidence` に残ります。

## 4. 生成への反映

`src/knowledge/corpus.ts` が `corpus-profile.generated.ts` を読み、
`planMessages()` のシステムプロンプトに「観測された傾向」ブロックを追加します。

例（実際の出力）:

```
Observed tendencies in a reference corpus of game-music MIDI arrangements
(statistics only; do not copy any specific piece). Use them as a style prior, not a rule:
- Tempo: the tempo metadata is uniform at 125 BPM across this corpus (authoring convention),
  so do not use tempo as a style prior — vary tempo to fit the request.
- Mode: major 53% / minor 48% — the corpus uses both about equally; match the mode to the
  request (bright/heroic material tends major) and do not default to minor.
- Instrument focus (by note count): synthLead 26%, guitar 21%, bass 16%, brass 8%.
- Drum emphasis: bassDrum 22%, snare 25%, closedHat 25%.
- Rhythm: downbeat onsets 27%, off-beat 8ths 25%, 16ths 48%.
- Harmonic rhythm: about 1 chord(s) per bar; borrowed/secondary chords in about 39% of chord slots.
...
- You may deviate from these priors when the user asks for something different.
```

設計上の判断:

- **プロファイルが null なら何も注入しない**（従来の挙動を保つ。テストでも担保）
- 数値は「目安」として提示し、強い制約にしない（LLM の表現を殺さない）
- コーパスのテンポが全曲同一など **情報量がない項目は「使うな」と明示**する
- 旋律・進行そのものは渡さない（ローマ数字の頻度まで）
- **モード（長調/短調）は統計の提示だけで LLM に任せない**（下節）

### モード（長調/短調）の決定

以前は `"key": string (e.g. "C minor")` の例示と「minor is common」という知見だけを渡し、
長調/短調の選択を LLM に任せていました。このためゲーム/戦闘/疾走系のリクエストでは
**16回中16回が短調**になり、参照コーパス（長調 53% / 短調 48%）と乖離していました。

現在は `src/prompt.ts` の `pickMode()` が生成ごとにモードを決定的に決め、
Variation ブロックで `Key: use exactly F major` のように主音とモードを明示します。

| 入力 | 決め方 |
|---|---|
| 「明るい」「勇ましい」「楽しい」等 | 長調に固定 |
| 「暗い」「悲しい」「ホラー」等 | 短調に固定 |
| 指定なし (例: 「ゲームのボス戦BGM」) | コーパスの `modeShare` (長調 52.5%) を seed 付き乱数で引く |

LLM が明示に反したモードを返した場合は作り直させ、それでも直らなければ
`src/theory/mode.ts` の `transposePlanToMode()` がローマ数字を保ったまま同主調へ
実現し直します（通常経路では発動しません）。

さらに、キーだけ長調で和音が並行短調に寄っている（例: `C major` に `Cm–Ab–Eb–Bb`）と
響きが短調になるため、`planModeConflict()` が「並行モードのトニック和音を含む借用が 40% 以上」を
検出して作り直させます（最終試行では許容するベストエフォート）。
プロンプトに載せる進行カードも、決めたモードのカードを優先し、ジャンル内に足りなければ
全体から同じモードのカードで補います（長調の曲に短調の定番カードを渡さない）。

## 5. 適合度指標（`src/eval/corpusFit.ts`）

生成物がプロファイルにどれだけ寄っているかを 0–100 で測ります。

| 項目 | 重み | 見ていること |
|---|---|---|
| tempo | 12（情報がない時は 0） | コーパスのテンポ帯との距離 |
| mode | 8 | 長調/短調の比率との一致 |
| meter | 6 | 拍子の出現率 |
| instruments | 12 | 楽器ファミリー構成のコサイン類似 |
| rhythm | 14 | 小節内 16 ステップのオンセット分布の類似 |
| drums | 10 | ドラム音の構成比の類似 |
| harmonicRhythm | 12 | 1小節あたりコード数の一致 |
| chordQualities | 10 | 和音品質の分布類似 |
| borrowed | 8 | 借用・二次ドミナント率の一致 |
| form | 8 | セクション長の一致 |

`complexity: rich` では意図的な逸脱を許すため、該当項目に下限（0.5〜0.7）を設けます。

## 6. 改善ループの回し方

1. `npm run analyze:corpus -- --dir out/corpus --no-fetch` で現状を記録
2. `npm run eval:corpus-fit` でベースライン（現フィクスチャ平均）を確認
3. プロンプト・ルール・重みを変更
4. `npm run eval:corpus-fit -- --rules-ab` で決定論的な効果を確認（LLM不要）
5. `npm run eval:corpus-fit -- --live` で実生成を測定（`.dev.vars` が必要）
6. 既存の和声評価（`npm run eval`）・複雑さ評価（`npm run eval:complexity`）を悪化させていないことも確認

### 実測結果（サンプル40曲のプロファイル）

**ルール層への適用は決定論的に効果あり**（`--rules-ab`、フィクスチャ12曲）

| 条件 | 適合度 |
|---|---|
| 適用なし | 66.1 |
| 適用あり | **76.4 (+10.3)** |

全12曲が +9.7〜+12.0 改善。項目別:

| 項目 | 適用なし | 適用あり | 差 |
|---|---|---|---|
| instruments | 82 | 99 | **+17** |
| rhythm | 40 | 61 | **+21** |
| form | 50 | 100 | **+50** |
| drums / tempo / mode / meter / harmonic / qualities / borrowed | — | — | ±0 |

- `instruments`: 音色の既定値 (comp=4, bass=33, melody=0) をコーパスの楽器構成へ補正。
  ジャンル別に選択する（ピアノ曲→piano、ロック→guitar、EDM/ゲーム→synthLead、既定→コーパス上位）
- `rhythm`: comp の既定値 `pad` を、コーパスの細分性に合う `syncopation` へ
- `form`: セクション未指定のプランにコーパス中央値 (4小節) のセクションを与える
- LLM を介さないため、この差は因果として読める

**プロンプト注入は現時点では効果を測定できていない**

`--live` の3条件（off / ルール層のみ / プロンプト+ルール）は平均 off 72.5 / rules 73.1 / both 75.2 だが、
同一条件内のプロンプト間分散が大きい（例: lofi で 84.7〜74.7）ため n=3 では有意差と言えない。
LLMのサンプリングばらつきが支配的。実装は次のように分離してある。

| フラグ | 既定 | 状態 |
|---|---|---|
| `corpusRules` | ON | ルール層（音色・スタイル・フォームの既定値）— 効果を確認済み (+10.3) |
| `corpusPrompt` | ON | プロンプトへの知見注入 — 評価継続中 |
| `corpus` | ON | 上記両方のマスタースイッチ |

### 仕組み（ルール層アダプタ）

`corpusRuleHints({ prompt })` がプロファイルから次を導き、`applyCorpusHints()` が
**スキーマ既定値のままの項目だけ**置換します（LLMの明示指定は尊重）。

| 出力 | 導出方法 | 適用先 |
|---|---|---|
| `drumPatterns` | 各パターンのGMドラム音別比率とコーパス `drums` のコサイン類似 | セクション `drums`（既定 `basic` のみ） |
| `compStyles` / `bassStyles` | 16分・裏8分・ダウンビート比率からスコアリング | セクション `comp`/`bass`（既定 `pad`/`root` のみ） |
| `programs` | ジャンル別優先順 × コーパスの楽器構成 | `compProgram`/`bassProgram`/`melodyProgram`（既定のみ） |
| `sectionBars` | セクション長の中央値 | セクション未指定時のフォーム |

### 次の改善候補

1. プロンプト注入の効果測定を n 増やす（条件あたり10曲以上）。現状は分散が大きく判定不能
2. `drums` 項目はまだ伸びていない（LLMが明示的にパターンを指定するため既定値のままになりにくい）。
   ロール（intro/chorus 等）に応じたパターン選択まで踏み込む余地あり
3. 拍節推定の精度向上（93%が推定値。誤推定は和声統計のノイズ源）
4. ジャンル別プロファイル（`--label` を分けて複数持ち、リクエストのジャンルで選択）

## 6.5. 参照 MIDI との距離（`npm run compare:corpus`）

参照 MIDI 群と生成曲を**同じ解析器**に通して特徴量を並べる CLI。
「サイトの曲にどこまで近いか」を主観ではなく数値で把握するためのもの。

```bash
npm run compare:corpus -- --live --bars=32    # 生成して比較
npm run compare:corpus -- --reuse            # 保存済み生成MIDIを再解析だけして比較 (高速)
npm run compare:corpus                        # フィクスチャと比較（ネットワーク不要）
```

実測（参照40曲 / 生成2曲・32小節・rich、中央値）:

| 指標 | 参照MIDI | 生成物 | 比 |
|---|---|---|---|
| 長さ (秒) | 78.0 | 75.0 | 0.96 |
| 小節数 | 42 | 32 | 0.76 |
| セクション数 | 7 | 6 | 0.86 |
| セクション長 (小節) | 6.1 | 5.5 | 0.89 |
| コード/小節 | 1.0 | 1.0 | 1.00 |
| ドラム音の種類数 | 5 | 7 | 1.40 |
| 旋律音域 (半音) | 31 | 33 | 1.06 |
| 音程 (順次進行) | 0.49 | 0.44 | 0.91 |
| **ノート数** | 3238 | 1231 | **0.38** |
| **密度 (音/秒)** | 42.0 | 18.8 | **0.45** |
| **使用チャンネル数** | 11.5 | 5 | **0.43** |
| **音色の種類数** | 6 | 3 | **0.50** |
| **借用・二次ドミナント率** | 0.40 | 0.00 | **0.00** |
| **旋律 音/小節** | 7.4 | 4.8 | **0.65** |

読み方:

- **近い**: 長さ・セクション構成・和声リズム・ドラムの音色数・旋律の音域/順次進行
- **足りない**: 声部数（チャンネル数）・密度・音色の種類・和声の色付け（借用/二次ドミナント）

つまり「同じジャンル・同じ構成の曲」は作れるが、参照曲の**作り込み密度（多声部・
刻み・和声の彩り）にはまだ届かない**。差を埋めるには次の順が効果的:

1. 声部の追加（パッド／アルペジオ／オブリガート／ハモリ）— チャンネル数 5→8 程度
2. コード語彙の色付け（sus/add9/二次ドミナント/借用を標準生成でも一定確率で使う）
3. 伴奏の細分化（comp/bass を刻む系へ寄せる既定値、16分の割合 0.39→0.5 へ）
4. ドラムの小節バリエーション（抽出済み `corpus1..8` のローテーション＋フィル/ブレイク）
5. 旋律密度の引き上げ（1フレーズの音符数、モチーフ反復の指示強化）

### 参照曲の作り込みへ寄せる実装

| モジュール | 内容 |
|---|---|
| `src/theory/texture.ts` | `Pad`（中高音の持続和音）/ `Arp`（8分・16分のアルペジオ）/ `Seq16`（16分のコードトーン・シーケンス）/ `Harmony`（主旋律のスケール内3度下）。チャンネル 4/5/6/7 |
| `src/theory/color.ts` | sus4 / 二次ドミナント / 借用(iv・bVI・bVII・bII)。最初と最後の2小節は不可触、`validate` で error が増えたら自動撤回 |
| `src/theory/form.ts` | 細切れセクションを参照コーパスの長さ（中央値6小節）へ併合 |
| `src/knowledge/corpus.ts` | `dense` 指定時に持続系 comp を `arpeggio16`、bass を `sixteenths` へ |
| `src/analyze/features.ts` | `melodyChannel` 指定で旋律指標を旋律トラックに限定（コーパスとの公平な比較用） |

実測（参照40曲 / 生成4曲・32小節・rich、中央値。比 = 生成物/参照）:

| 指標 | 初期 | 最終 |
|---|---|---|
| 密度 | 0.45 | **0.99** |
| 平均同時発音数 | 0.81 | **1.31** |
| セクション長 | 0.81 | **0.96** |
| 借用・二次ドミナント率 | 0.00 | **0.69** |
| 16分の割合 | 0.66 | 0.62 |
| 音色の種類数 | 0.50 | **0.83** |
| ドラム音の種類数 | — | **1.30** |
| 使用チャンネル数 | 0.43 | **0.70** |
| ノート数 | 0.38 | 0.69 |
| セクション数 | 0.86 | 0.79 |

旋律系は計測方法で意味が変わるため2通り併記（`--reuse` で再解析のみ可能）:

| 指標 | 参照MIDI | 生成物 | 比 |
|---|---|---|---|
| 旋律音域（旋律ch限定） | 31 | 15.5 | 0.50 |
| 旋律 音/小節（旋律ch限定） | 7.4 | 3.2 | 0.43 |
| 順次進行（旋律ch限定） | 0.49 | 0.61 | 1.25 |
| 旋律音域（最高声部） | 31 | 21 | 0.68 |
| 旋律 音/小節（最高声部） | 7.4 | 9.6 | **1.30** |
| 順次進行（最高声部） | 0.49 | 0.31 | 0.64 |

読み方: 参照MIDIはパート情報が無いため「最高声部」が複数声部の合成になり、旋律密度が
実際より高く出ます。こちらの旋律chは**単旋律として 3.2音/小節**で、参照の単旋律相当より
やや少なめ。一方、曲全体の厚み（最高声部ベース）は参照と同等以上になりました。

### 残る差と次の候補

1. **16分の割合（0.62）**: `Seq16` を追加して改善。ただし参照は常時16分のため、
   さらに comp を単音16分へ寄せる余地
2. **借用率のばらつき（0.69）**: 色付けは seed 依存。`rich` では強度1.0で固定済みだが、
   生成される進行によっては上限に達しないことがある
3. **旋律の音域・密度（旋律ch限定 0.50 / 0.43）**: 単旋律としては控えめ。メロディ生成の
   プロンプトで「1フレーズの音符数を増やす」「音域を広げる」を強化する余地
4. **セクション数のばらつき**: LLMの初回出力に依存（3〜9セクション）。フォーム併合は
   上限方向にしか効かないため、下限側の補正も検討

### ドラムパターンの辞書化

`npm run analyze:corpus` は集計に加えて、参照 MIDI で**頻出する1小節ドラムパターン**を
`src/knowledge/drum-patterns.generated.ts` へ書き出します（最大8個、`corpus1`〜`corpus8`）。
これらは [src/theory/drums.ts](src/theory/drums.ts) のパターン辞書へ自動登録され、
プロンプトの選択肢（`DRUM_PATTERN_NAMES`）にも現れます。旋律は保存しません。



## 7. 既知の限界

- コード推定はテンプレート照合のため、転回形・テンション・ペダルポイントが多い曲では誤検出があります。
  借用率などの和声指標は「傾向」としてのみ利用してください。
- セクション境界検出はクロマ変化ベースの近似です。細かいフィルやブレイクは拾えません。
- 参照コーパスは 1 作者のゲーム音楽編曲に偏っています（テンポ規約が全曲同一など）。
  別ジャンルのコーパスを足す場合は `--dir` を分けて `aggregateFeatures` を複数回回し、
  プロファイルを選び分けるのが安全です。
- 取得対象サイトの利用条件は変わることがあります。再取得前に必ず確認してください。

## 8. ファイル一覧

| ファイル | 役割 |
|---|---|
| `src/midi/parseMidi.ts` | SMF パーサー（依存なし） |
| `src/analyze/features.ts` | 1曲の特徴抽出・拍節推定・コード推定 |
| `src/analyze/corpus.ts` | 特徴の集計とプロファイル型 |
| `src/analyze/links.ts` | 一覧 HTML からのリンク抽出 |
| `scripts/analyze-corpus.ts` | 取得・解析・集計 CLI |
| `src/knowledge/corpus-profile.generated.ts` | 生成された集計データ（自動生成） |
| `src/knowledge/corpus.ts` | プロファイルを生成側で使う層 |
| `src/prompt.ts` | プロンプトへの注入 |
| `src/eval/corpusFit.ts` | 適合度指標 |
| `scripts/eval-corpus-fit.ts` | 適合度 CLI |
| `test/parseMidi.test.ts` | パーサーの往復テスト |
| `test/corpus.test.ts` | 集計・適合度・リンク抽出のテスト |

