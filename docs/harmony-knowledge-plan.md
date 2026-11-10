# コード進行「前提知識」強化計画

対象: `music-creator`（プロンプト → LLM が曲の設計 → ルール層が伴奏/ベース/ドラムを生成 → メロディを採点）
前提: 現状のテストは 14 件すべて成功（`npm test`）。既存の公開 API（`compose` / `PlanSchema` / `parseChord`）は壊さない。

---

## 1. 目的

「コード進行の前提知識」を、**LLM の潜在知識に任せず、リポジトリ内の明示的な知識として持つ**。

- 宣言的知識: 進行のカタログ（ローマ数字・機能・ジャンル・使用例・注意点）
- 実行可能知識: 度数解析・機能分類・カデンツ検出・検証・自動補正・声部連結

これにより、次の 3 つを達成する。

1. LLM が出した進行を**説明できる**（I–vi–ii–V が何をしているか）
2. 破綻した進行を**検出して直せる**（調外・機能逆行・カデンツなし・終止しない）
3. ジャンルに合った進行を**選ばせられる**（プロンプトに語彙として注入）

最終的な合格条件（Definition of Done）:

- どのプランも生成前に「解析 → 検証 → 補正」を通る
- 進行カードが 5 ジャンル・30 枚以上あり、全カードが 12 キーで実現できる
- ボイシングが並行 5 度/8 度・声部交差を起こさない
- 評価ハーネスで改善が数値で確認できる（カデンツ率・調内率など）
- `?explain=1` でローマ数字つきの解析結果が返る

---

## 2. 現状の棚卸し

| 領域 | いまあるもの | 足りないもの |
|---|---|---|
| コード記号 | `theory/harmony.ts`: 17 品質 + エイリアス + 分数コードのベース音 | 分数コードを「転回形」として機能解釈する視点 |
| 調 | `theory/index.ts`: `parseKey`（major/minor）、7 スケール | 調号、借用和音、二次ドミナント、転調の概念 |
| 進行 | `plan.chords` は `[beat, symbol]` のフラット配列 | 度数・機能・カデンツ・和声リズムという単位が存在しない |
| 検証 | `compose.ts` は `parseChord` が通るかだけ確認 | 進行の妥当性（機能順序・終止・調整合）は未検証 |
| ボイシング | `voice()` は各構成音を前回の中心へ最近接で置くだけ | 並行 5 度/8 度、声部交差、間隔、重複、導音解決の制御 |
| 知識 | `knowledge/genres.ts` に 5 枚のカード（英文 1 行） | 進行例・機能・カデンツ・和声リズムの記述 |
| テスト | 14 件（パイプライン中心） | 和声進行の品質に関するテストはゼロ |

### いま起きうる具体的な破綻

- `C major` と言いながら `C – F#m – Bb – G` のような無機能な並びが出る
- `V → IV`（ドミナントからサブドミナントへの逆行）が普通に出る
- コードが小節頭でなく 1.5 拍目で変わる／1 小節に 3 回変わる
- 最終小節がトニックで終わらず、解決感がない
- `voice()` が前の和音と 5 度関係のとき、外声が並行 5 度で動く
- セクション境界（A → B）にカデンツがなく、盛り上がりが「ただ音が増えただけ」になる

---

## 3. 「知識」を 3 層に分ける

| 層 | 内容 | 置き場所 | 使われ方 |
|---|---|---|---|
| 語彙 | コード記号・品質・テンション・分数コード | `theory/harmony.ts`（既存） | 解析の入力 |
| 文法 | 機能和声（T/S/D）、傾向音、カデンツ、二次ドミナント、借用和音 | `theory/roman.ts` ほか（新規） | 検証・補正・説明 |
| 様式 | ジャンル別の進行・和声リズム・ボイシング習慣 | `knowledge/progressions.ts`（新規） | プロンプト注入・選択 |

文法は**コードで実行**し、様式は**データとして保持**する。この分離が重要で、様式（「J-pop なら王道進行」）をコードに埋め込むと変更のたびにテストが壊れる。

---

## 4. 目標アーキテクチャ

```
src/theory/
  harmony.ts     既存: 記号解析・ボイシング（API は維持）
  key.ts         新規: KeyContext（調・スケール・ダイアトニック和音表）
  roman.ts       新規: コード → ローマ数字（度数・品質・転回・二次ドミナント・借用）
  functions.ts   新規: T/S/D 分類、機能進行の妥当性（逆行検出）
  cadence.ts     新規: カデンツ検出（PAC/IAC/HC/PC/DC）
  validate.ts    新規: 進行全体の検証（Issue[] を返す）
  repair.ts      新規: 決定的な自動補正
  voicing.ts     新規: 進行単位のボイシング（DP で最小コスト経路）

src/knowledge/
  progressions.ts 新規: ProgressionCard[]（進行カタログ）
  genres.ts       拡張: 各ジャンルから進行カード ID を参照
```

データの流れ:

```
プロンプト
  └─ planMessages: ジャンルカード + 進行カード（ローマ数字と実現例）を注入
       └─ LLM: Plan（key, chords, sections）
            ├─ analyzePlan: 各コードをローマ数字へ（説明・デバッグ用）
            ├─ validateProgression: Issue[]（error / warn / info）
            │    └─ error あり → 既存の再試行ループで LLM に差し戻し
            ├─ repairProgression: warn を決定的に補正
            └─ 伴奏生成: voicing.ts で声部連結 → comp / bass
```

---

## 5. フェーズ計画

### Phase 0 — 基準づくり（規模: S）

**目的**: 「良い進行」の判定基準を先に文章とテストで固定する。実装より先にここをやる。

作業:

- `docs/harmony-criteria.md`: 機能順序（T→S→D→T）、カデンツの種類、借用和音の許容範囲、和声リズムの目安を明文化
- `test/harmony.test.ts` に「こうなったら失敗」の期待を列挙（最初は `it.todo` でもよい）
- 判定は 3 段階に固定する: `error`（生成をやり直す）/ `warn`（補正する）/ `info`（記録だけ）

完了条件: 検証ルールの一覧が Issue コードとして確定している。

### Phase 1 — 機能和声モデル（規模: M）

**目的**: 任意のコードを、調に対する度数と機能として説明できるようにする。

作業:

- `key.ts`
  - `KeyContext = { root, mode: "major" | "minor", scale }`
  - ダイアトニック三和音・七和音の表（長調 / 自然短調 / 和声短調）
  - `degreeChord(key, degree, quality)` → コード記号
- `roman.ts`
  - `analyzeChord(symbol, key)` → `{ degree, accidental, quality, numeral, inversion, function, isDiatonic, borrowedFrom? }`
  - 対応: 転回形（`C/E` → `I6`）、二次ドミナント（`V/V`）、裏コード（`bII7`）、借用（`iv`, `bVI`, `bVII`, `bIII`）、ナポリ（`bII`）
- `functions.ts`
  - T/S/D 分類（iii と vi は T 寄り、vii° は D）
  - `retrogression(prev, next)` → D→S の検出
- `cadence.ts`
  - `detectCadence(prev, last, key)` → PAC / IAC / HC / PC / DC / none
- `test/roman.test.ts`: 表駆動で 30 ケース以上（長調・短調・転回・二次ドミナント・借用）

完了条件: 例として `Cmaj7 Am7 Dm7 G7` が `I△7 → vi7 → ii7 → V7`、機能 `T → T → S → D`、最後が HC と出力される。

### Phase 2 — 進行ライブラリ（規模: M）

**目的**: ジャンル別の進行を、検証可能なデータとして持つ。

`ProgressionCard` の型:

```ts
type ProgressionCard = {
  id: string;              // "jpop-oudou"
  name: string;            // "王道進行"
  numerals: string[];      // ["IVmaj7", "V7", "iii7", "vi"]
  bars: number;            // 4
  genres: string[];        // ["jpop", "anime", "citypop"]
  tempo: [number, number];
  feel: string;            // "切なさ → 宙吊り"
  harmonicRhythm: number;  // 1小節あたりのコード数
  examples?: string[];     // 参考曲名（進行の著作権はないが、曲名は参考情報に留める）
  usage: string;           // どこで使うか（A メロ / サビ前 / エンディング）
};
```

収録の目安（合計 30〜40 枚）:

| 系統 | 例 |
|---|---|
| J-pop / アニメ | 王道進行 `IV△7–V7–iii7–vi`、小室進行 `vi–IV–V–I`、丸サ進行 `IV△7–III7–vi7–I7`、4536、1564、2516、カノン進行 |
| 洋楽ポップ / ロック | `I–V–vi–IV`、`vi–IV–I–V`、`I–IV–V`、`I–bVII–IV`、`i–bVI–bIII–bVII` |
| ジャズ | `ii7–V7–Imaj7`、`iiø7–V7–i`、ターンアラウンド `I–vi–ii–V`、リズムチェンジ、12 小節ブルース |
| EDM / ダンス | `vi–IV–I–V`、`i–VI–III–VII`、4 コードループ |
| ローファイ / シティポップ | `Imaj7–vi7–ii7–V7`、`Imaj7–IVmaj7–iii7–vi7` |
| クラシック | `I–IV–V–I`、5 度循環のシーケンス、`I–vi–IV–V` |

作業:

- `knowledge/progressions.ts` にデータを書く
- `realize(card, key)` でローマ数字 → 実際のコード記号（`analyzeChord` の逆）
- `test/progressions.test.ts`: 全カードが 12 キーで実現でき、`validate` が error を出さない

完了条件: カードがジャンル横断で 30 枚以上、全カードが往復（実現 → 解析）で一致する。

### Phase 3 — 検証と自動補正（規模: L）

**目的**: LLM の進行をそのまま使わず、検証して直す。

`validate.ts` の Issue コード（案）:

| コード | 重大度 | 意味 |
|---|---|---|
| `PARSE_ERROR` | error | 記号が解釈できない |
| `KEY_MISMATCH` | error | 宣言した調と和音が噛み合わない |
| `NO_TONIC` | warn | トニックが一度も出ない |
| `NO_CADENCE` | warn | 最後の 2 小節に終止がない |
| `WEAK_ENDING` | warn | 最終和音がトニックでない |
| `RETROGRESSION` | warn | D→S の逆行（例 `V→IV`） |
| `HARMONIC_RHYTHM` | info | 拍頭以外でのコードチェンジ、極端に短い/長い和音 |
| `TOO_FEW_CHORDS` / `TOO_MANY_CHORDS` | warn | 4 小節に 2 未満 / 8 超 |
| `SECTION_CADENCE` | warn | セクション境界に終止がない |
| `CHROMATIC_UNEXPLAINED` | info | 借用でも二次ドミナントでもない調外音 |

`repair.ts` の補正（すべて決定的・乱数なし）:

1. コードオンセットを拍グリッドへスナップ
2. 1 拍未満の和音を直前の和音へ統合
3. 最終和音がトニックでない → 直前を `V` にして最終をトニックへ（`V–I` を保証）
4. 終止がない → 最後の 2 小節を `ii–V` または `V–I` に置換
5. 調外和音 → 同じルート motion を保つダイアトニック和音へ置換（機能を保存）
6. セクション境界の直前小節に `V` を挿入

統合（`compose.ts`）:

- `PlanSchema.parse` の後、`parseChord` チェックを `validateProgression` に置き換え
- `error` があれば既存の再試行ループのメッセージに Issue を載せて LLM に返す
- `maxAttempts` 後も error なら `repairProgression` で強制補正して続行

完了条件: 各 Issue コードに 1 つ以上のテスト。既存 14 テストが緑のまま。

### Phase 4 — ボイシングと声部連結（規模: L）

**目的**: 伴奏の和音連結を「自然」にする。

現状の `voice()` は各音を独立に最近接へ置くため、外声の並行 5 度/8 度が起こりうる。

作業（`voicing.ts`）:

- 各和音につき候補ボイシングを列挙（転回形・オクターブ配置・5 度省略）
- 進行全体を DP（Viterbi）で解き、次を最小化するコストを選ぶ
  - 声部の移動量（共通音は保持）
  - 声部交差・間隔超過（ソプラノ〜バス）
  - 並行 5 度 / 8 度
  - 導音の上行解決、7th の下行解決
  - 音域（`GM_RANGES`）
- ベースはルート/5 度/3 度 + 次和音への半音アプローチ
- `voice()` は残し、`voiceProgression()` を追加（後方互換）

完了条件: `V→I` で並行 5 度を作る入力が、補正後の出力で並行 5 度 0 になるテスト。

### Phase 5 — プロンプトへの知識注入（規模: M）

**目的**: LLM に「選べる進行の語彙」と「守るべき文法」を与える。

作業:

- `prompt.ts`: ジャンルカードから進行カードを 2〜3 枚選び、ローマ数字 + 指定キーでの実現例 + 使用場面を注入
- `PLAN_SYSTEM` に追記:
  - 提供された進行を 1 つ選び、必要なら一部だけ置換してよい
  - 機能順序 `T→S→D→T` を守る
  - セクション末尾はカデンツで終える
  - 和声リズムは 1 小節 1〜2 和音に揃える
- メロディ用プロンプトにも「どの和音が緊張点か」を 1 行で渡す（任意）
- `index.ts`: `?explain=1` で `{ analysis, issues }` を返す（学習・デバッグ用）
- `public/index.html`: 任意でローマ数字を表示（余力があれば）

完了条件: 同じプロンプトで、注入あり/なしの検証通過率を比較できる。

### Phase 6 — 評価ハーネス（規模: M）

**目的**: 改善を主観ではなく数値で見る。

作業:

- `scripts/eval-harmony.ts`
  - 入力: 保存済みの Plan JSON 30 件（LLM 出力のフィクスチャ）
  - 指標: カデンツ率、調内率、トニック終止率、逆行率、平均 Issue 数、並行 5 度率
  - 出力: Markdown 表 + JSON（`out/eval-*.json`）
- `test/eval.test.ts` はネットワークなしでフィクスチャだけ回す
- ライブ評価（`--live`）は任意。API キーが要るので CI では回さない

完了条件: ベースライン数値が記録され、Phase 3/5 の前後で比較できる。

### Phase 7 — 発展（任意）

- 転調: セクション単位のキー変更、ピボット和音
- リハーモナイズ: 既存メロディに対する和音代替案の提示
- モーダル・インターチェンジの拡張（ドリアン/ミクソリディアンの借用）

---

## 6. データ設計（型の確定版）

```ts
// key.ts
type KeyContext = { root: number; mode: "major" | "minor" };

// roman.ts
type Analysis = {
  degree: number;            // 1..7
  accidental: -1 | 0 | 1;    // b / natural / #
  quality: string;           // "maj7" | "7" | "m7" | ...
  numeral: string;           // "V7", "bVII", "V7/V"
  inversion: 0 | 1 | 2 | 3;
  fn: "T" | "S" | "D" | "T/S" | "D/T";
  isDiatonic: boolean;
  borrowedFrom?: "parallelMinor" | "parallelMajor" | "neapolitan" | "tritoneSub";
};

// validate.ts
type Issue = {
  code: string;
  severity: "error" | "warn" | "info";
  beat?: number;
  message: string;
  fix?: string;
};
```

---

## 7. 既存コードへの統合点

| ファイル | 変更 |
|---|---|
| `src/theory/harmony.ts` | 変更なし（API 維持）。分割は Phase 4 で `voicing.ts` に移すだけ |
| `src/theory/index.ts` | `SCALES` を `key.ts` から参照する形に整理（任意） |
| `src/plan.ts` | 任意フィールド `progressionId?`, `romanNumerals?` を追加（後方互換） |
| `src/compose.ts` | `parseChord` 検証 → `validateProgression` + `repairProgression` |
| `src/prompt.ts` | 進行カードの注入、文法ルールの追記 |
| `src/knowledge/genres.ts` | `progressionIds: string[]` を追加 |
| `src/index.ts` | `?explain=1` のレスポンス拡張 |
| `test/` | `roman` / `progressions` / `validate` / `voicing` / `repair` の追加 |

---

## 8. テスト方針

- **表駆動**: ローマ数字解析は 30 ケース以上の表で固定
- **往復**: 進行カード → 実現 → 解析 で元のローマ数字に戻る
- **不変条件**: どのカードも 12 キーで `error` を出さない
- **回帰**: 既存 14 テストは常に緑。`assemble` の構造テストは維持
- **ゴールデン**: 固定プラン → 固定ボイシングのスナップショット（Phase 4）
- **ネットワーク禁止**: テストは LLM を呼ばない

---

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| 知識で縛りすぎて LLM の表現が死ぬ | `error` は解析不能と調不整合だけ。進行の好みは `warn`/`info` に留める |
| 進行カードのコピー感が出る | カードは骨格（ローマ数字）だけ。実現時に置換・借用を許す |
| データが増えて保守できない | カードは 1 ファイル・型で強制。テストで全件検証 |
| スコープが膨らむ | M1〜M3 を先に。Phase 7 は切る前提で設計 |
| 著作権 | 進行（ローマ数字）は保護対象外。曲名は参考情報として最小限 |

---

## 10. マイルストーン

| # | 内容 | 含む Phase | 状態の目安 |
|---|---|---|---|
| M1 | 進行を「理解・説明」できる | 0, 1, 2 | 解析とカードが揃う |
| M2 | 進行を「検証・補正」できる | 3 | 破綻した進行が直る |
| M3 | 伴奏が「自然」になる | 4, 5 | 声部連結とプロンプト注入 |
| M4 | 改善を「測れる」 | 6 | ベースライン比較 |

---

## 11. 最初の一歩（この順で）

1. `src/theory/key.ts` — `KeyContext` とダイアトニック和音表
2. `src/theory/roman.ts` — `analyzeChord(symbol, key)`
3. `test/roman.test.ts` — 表駆動 30 ケース
4. `src/theory/cadence.ts` + `functions.ts` — カデンツと機能分類
5. ここまでで `docs/harmony-criteria.md` の基準と照合し、Phase 2 のデータへ

最初の 3 ステップは既存コードに触れず追加だけで済むため、安全に始められる。

---

## 12. 実装状況

| Phase | 状態 | 成果物 |
|---|---|---|
| 0 基準づくり | ✅ 完了 | `docs/harmony-criteria.md` |
| 1 機能和声モデル | ✅ 完了 | `src/theory/key.ts`, `roman.ts`, `functions.ts`, `cadence.ts`, `test/roman.test.ts` |
| 2 進行ライブラリ | ✅ 完了 | `src/knowledge/progressions.ts`（34 枚 / 15 ジャンル）, `genres.ts`, `test/progressions.test.ts` |
| 3 検証・補正 | ✅ 完了 | `src/theory/validate.ts`, `repair.ts`, `test/validate.test.ts`, `compose.ts` 統合 |
| 4 ボイシング | ✅ 完了 | `src/theory/voicing.ts`（DP + drop-2 + 並行5度/8度・密集の回避）, `accompaniment.ts` 統合, `test/voicing.test.ts` |
| 5 プロンプト統合 | ✅ 完了 | `src/prompt.ts`（進行カード注入）, `compose.ts`（harmony / issues 返却）, `index.ts`（`?explain=1`）, `test/prompt.test.ts` |
| 6 評価ハーネス | ✅ 完了 | `src/eval/harmony.ts`, `scripts/eval-harmony.ts`, `test/fixtures/plans/`（12 件）, `test/eval.test.ts`, `npm run eval` |
| 7 発展 | ✅ 完了 | `src/theory/modulation.ts`, `src/theory/reharmonize.ts`, `test/modulation.test.ts`, `test/reharmonize.test.ts` |

Phase 1〜7 の受け入れ基準は `docs/harmony-criteria.md` §7 のとおり。`npm run typecheck` と `npm test`（123 件）が成功している。
生成パイプラインは、進行カードの注入 → 設計 JSON の検証（error は LLM へ差し戻し）→ 補正（warn は決定的に修正）→ 伴奏生成（DP ボイシング）の順で動く。
`POST /api/compose?explain=1` は、補正後の各コードのローマ数字・機能、残った Issue、リハーモナイズ案を返す。

### 評価ベースライン（`npm run eval`、12 フィクスチャ）

| 指標 | 値 |
|---|---|
| カデンツ率 | 92%（残りは 1 和音だけの `bad-sparse`） |
| トニック終止 | 100% |
| 調内（借用・二次ドミナント含む） | 98% |
| 補正後に error が残るプラン | 0% |
| Issue 平均 | 1.25 → 0.25 |
| 適用した補正 | 8 件 |

フィクスチャは `test/fixtures/plans/*.json`。`npm run eval` は Markdown を標準出力に、JSON を `out/eval-*.json` に書く。ネットワークは使わない。

### Phase 7 で追加したもの（ライブラリ）

| モジュール | 内容 |
|---|---|
| `src/theory/modulation.ts` | `closelyRelatedKeys`（属調・下属調・平行調・同主調）、`pivotChords`（両調で共通の三和音）、`suggestModulation`（新調で ii/IV/V になるピボットを優先して提案） |
| `src/theory/reharmonize.ts` | `substitutionsFor`（T/S/D の機能代理、V7→viiø7、裏コード `bII7`）、`reharmonizePlan`（最後のトニックは動かさない） |
| `src/theory/roman.ts` | 短調の `IV` をドリアンからの借用として `borrowedFrom: "dorian"` に |

転調は生成パイプラインにはまだ組み込んでいない（単一キーの `Plan` を前提にしているため）。リハーモナイズ案は `POST /api/compose?explain=1` の `suggestions` で取得できる。


