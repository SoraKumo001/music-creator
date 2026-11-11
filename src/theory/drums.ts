import { GM_DRUMS } from "./index";
import { CORPUS_DRUM_PATTERNS } from "../knowledge/drum-patterns.generated";
import type { EndingStyle, Section } from "../plan";
import type { Note } from "../score";
import { mulberry32 } from "../util/random";

/** 1小節(16分グリッド)のパターン。値は [ステップ(0-15), ドラム名, ベロシティ] */
type Hit = [number, keyof typeof GM_DRUMS, number];

/** コーパスから抽出したパターンのドラム名 → GM_DRUMS のキー */
const GM_NAME_TO_KEY: Record<string, keyof typeof GM_DRUMS> = {
  acousticBassDrum: "kick", bassDrum: "kick", sideStick: "snare", snare: "snare",
  handClap: "snare", electricSnare: "snare", lowFloorTom: "tomLow", highFloorTom: "tomLow",
  pedalHat: "closedHat", closedHat: "closedHat", openHat: "openHat",
  lowTom: "tomLow", lowMidTom: "tomLow", hiMidTom: "tomHigh", highTom: "tomHigh",
  crash: "crash", crash2: "crash", chineseCymbal: "crash", splash: "crash",
  ride: "ride", rideBell: "ride", tambourine: "closedHat",
};

/** コーパス由来パターンを BAR_PATTERNS へ変換 (重複ノート除去 + 欠落パート補完) */
function corpusPatterns(): Record<string, Hit[]> {
  const out: Record<string, Hit[]> = {};
  for (const pattern of CORPUS_DRUM_PATTERNS) {
    // 同一ステップ・同一ドラムキーの重複 (snare と electricSnare の同時発音等) を最大ベロシティで統合
    const byStepKey = new Map<string, Hit>();
    for (const [step, name, vel] of pattern.steps) {
      const key = GM_NAME_TO_KEY[name];
      if (!key) continue;
      const k = `${step}:${key}`;
      const prev = byStepKey.get(k);
      if (!prev || vel > prev[2]) byStepKey.set(k, [step, key, vel]);
    }
    const hits: Hit[] = [...byStepKey.values()];
    if (hits.length === 0) continue;

    // スネアロールのみの断片パターン (corpus2/4/5 等) が通常セクションに選ばれても単調にならないよう、
    // キックまたはハイハット/シンバルが全く無い場合は基本パルスを補完する
    const hasKick = hits.some(([, k]) => k === "kick");
    const hasTop = hits.some(([, k]) => k === "closedHat" || k === "openHat" || k === "ride");
    if (!hasKick) {
      for (const s of [0, 8]) {
        if (!byStepKey.has(`${s}:kick`)) hits.push([s, "kick", 96]);
      }
    }
    if (!hasTop) {
      for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) {
        hits.push([s, "closedHat", s % 4 === 0 ? 76 : 56]);
      }
    }
    out[pattern.name] = hits;
  }
  return out;
}

const BAR_PATTERNS: Record<string, Hit[]> = {
  lofi: [
    [0, "kick", 90],
    [6, "kick", 70],
    [8, "kick", 80],
    [4, "snare", 60],
    [12, "snare", 65],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 40 : 55],
    ),
  ],
  rock: [
    [0, "kick", 108],
    [6, "kick", 92],
    [8, "kick", 104],
    [11, "kick", 88],
    [4, "snare", 108],
    [12, "snare", 108],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 72 : 92],
    ),
  ],
  drive: [
    [0, "kick", 112],
    [3, "kick", 92],
    [6, "kick", 100],
    [8, "kick", 108],
    [10, "kick", 96],
    [14, "kick", 94],
    [4, "snare", 112],
    [7, "snare", 56],
    [12, "snare", 112],
    [15, "snare", 60],
    [2, "openHat", 84],
    [10, "openHat", 84],
    ...[0, 4, 6, 8, 12, 14].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 74 : 92],
    ),
  ],
  fourOnFloor: [
    [0, "kick", 110],
    [4, "kick", 105],
    [8, "kick", 110],
    [12, "kick", 105],
    [4, "snare", 90],
    [12, "snare", 90],
    ...[2, 6, 10, 14].map((s): Hit => [s, "openHat", 75]),
  ],
  swing: [
    ...[0, 4, 8, 12].map((s): Hit => [s, "ride", 80]),
    ...[6, 14].map((s): Hit => [s, "ride", 60]),
    [4, "snare", 45],
    [12, "snare", 45],
    [0, "kick", 50],
  ],
  basic: [
    [0, "kick", 100],
    [8, "kick", 95],
    [4, "snare", 100],
    [12, "snare", 100],
    ...[0, 4, 8, 12].map((s): Hit => [s, "closedHat", 70]),
  ],
  waltz: [
    [0, "kick", 100],
    [4, "snare", 65],
    [8, "snare", 65],
    ...[0, 2, 4, 6, 8, 10].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 55 : 70],
    ),
  ],
  halftime: [
    [0, "kick", 105],
    [8, "snare", 108],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 60 : 80],
    ),
  ],
  shuffle: [
    [0, "kick", 100],
    [8, "kick", 90],
    [4, "snare", 100],
    [12, "snare", 100],
    ...[0, 3, 4, 7, 8, 11, 12, 15].map(
      (s, i): Hit => [s, "closedHat", i % 2 ? 60 : 78],
    ),
  ],
  game16th: [
    [0, "kick", 110],
    [6, "kick", 92],
    [8, "kick", 104],
    [10, "kick", 90],
    [4, "snare", 108],
    [12, "snare", 108],
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(
      (s, i): Hit => [s, "closedHat", i % 4 === 0 ? 88 : i % 2 === 0 ? 72 : 56],
    ),
  ],
  // コーパスから抽出した実パターン (corpus1..)。リストは生成データの有無で変わる
  ...corpusPatterns(),
};

export const DRUM_PATTERN_NAMES = Object.keys(BAR_PATTERNS);

/** コーパス由来のパターン名 (生成側で優先候補として使う) */
export const CORPUS_PATTERN_NAMES = Object.keys(corpusPatterns());

/** 各ドラムパターンの GM 音別の出現比 (合計1)。コーパスとの比較用 */
export function drumPatternPitchShares(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [name, hits] of Object.entries(BAR_PATTERNS)) {
    const counts: Record<string, number> = {};
    for (const [, drum] of hits) {
      const pitch = String(GM_DRUMS[drum as keyof typeof GM_DRUMS]);
      counts[pitch] = (counts[pitch] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const shares: Record<string, number> = {};
    for (const [pitch, c] of Object.entries(counts)) shares[pitch] = c / total;
    out[name] = shares;
  }
  return out;
}

/** 各ドラムパターンの1小節あたりヒット数。セクション密度の比較用 */
export function drumPatternHitsPerBar(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, hits] of Object.entries(BAR_PATTERNS)) out[name] = hits.length;
  return out;
}

/** GM ドラム番号: トム系 (41,43,45,47,48,50) とスネア系 (38,40) */
const TOM_PITCH_SET = new Set([41, 43, 45, 47, 48, 50]);
const SNARE_PITCH_SET = new Set([38, 40]);

/**
 * 生成/解析済みのドラムノートからフィル統計を出す。
 * トム2打以上またはスネア6打以上の小節を「フィル」とみなす (解析側と同じ基準)。
 */
export function drumFillStats(
  notes: { pitch: number; start: number }[],
  bars: number,
  beatsPerBar = 4,
): { barsWithDrums: number; fillBars: number; phraseEndBars: number; phraseEndFills: number } {
  const out = { barsWithDrums: 0, fillBars: 0, phraseEndBars: 0, phraseEndFills: 0 };
  for (let bar = 0; bar < bars; bar++) {
    const from = bar * beatsPerBar;
    const to = from + beatsPerBar;
    const hits = notes.filter((n) => n.start >= from && n.start < to);
    if (hits.length === 0) continue;
    out.barsWithDrums++;
    const isPhraseEnd = bar % 4 === 3;
    if (isPhraseEnd) out.phraseEndBars++;
    const toms = hits.filter((n) => TOM_PITCH_SET.has(n.pitch)).length;
    const snares = hits.filter((n) => SNARE_PITCH_SET.has(n.pitch)).length;
    if (toms >= 2 || snares >= 6) {
      out.fillBars++;
      if (isPhraseEnd) out.phraseEndFills++;
    }
  }
  return out;
}

/** パターンの分類別ヒット数 (人間向けの要約) */
export type DrumPatternMix = { kick: number; snare: number; hat: number; cymbal: number; tom: number };
const CATEGORY: Record<string, keyof DrumPatternMix> = {
  kick: "kick", snare: "snare", closedHat: "hat", openHat: "hat", pedalHat: "hat",
  ride: "cymbal", rideBell: "cymbal", crash: "cymbal", crash2: "cymbal", splash: "cymbal", chineseCymbal: "cymbal",
  tomLow: "tom", tomHigh: "tom", lowTom: "tom", midTom: "tom", highTom: "tom",
};

/** 各ドラムパターンの構成比 (合計1) */
export function drumPatternMixes(): Record<string, DrumPatternMix> {
  const out: Record<string, DrumPatternMix> = {};
  for (const [name, hits] of Object.entries(BAR_PATTERNS)) {
    const mix: DrumPatternMix = { kick: 0, snare: 0, hat: 0, cymbal: 0, tom: 0 };
    for (const [, drum] of hits) {
      const cat = CATEGORY[drum as string];
      if (cat) mix[cat] += 1;
    }
    const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
    out[name] = {
      kick: mix.kick / total, snare: mix.snare / total, hat: mix.hat / total,
      cymbal: mix.cymbal / total, tom: mix.tom / total,
    };
  }
  return out;
}

const vel = (v: number, gain: number) =>
  Math.max(1, Math.min(127, Math.round(v * gain)));

/**
 * セクションごとのパターンからドラムを作る。
 *  - セクション頭にクラッシュ、セクション最終小節にフィル(次のセクションがある場合)
 *  - 曲の最終小節は1拍目のキック+クラッシュだけで締める
 */
export function generateDrums(
  sections: Section[],
  beatsPerBar = 4,
  ending: EndingStyle = "button",
  loop = false,
  opts: { seed?: number; fillRate?: number } = {},
): Note[] {
  const notes: Note[] = [];
  const rand =
    opts.seed !== undefined ? mulberry32((opts.seed ^ 0xc2b2ae35) >>> 0) : null;
  const human = () => (rand ? Math.floor(rand() * 5) - 2 : 0);
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);
  sections.forEach((sec, si) => {
    if (sec.drums === "none") {
      // seed指定時: ドラムなしセクション(イントロ等)からドラムありセクションへ移行する直前、
      // 最終小節の後半(3〜4拍目)に16分ハイハットクレッシェンドで突入 (Ys II / 80sゲームロック演出)
      const nextSec = sections[si + 1];
      if (rand && nextSec && nextSec.drums !== "none" && beatsPerBar >= 4) {
        const lastBarBase = (sec.startBar + sec.bars - 1) * beatsPerBar;
        for (let i = 0; i < 8; i++) {
          const start = lastBarBase + 2 + i * 0.25;
          const v = 30 + i * 7;
          notes.push({
            pitch: GM_DRUMS.closedHat,
            start,
            duration: 0.25,
            velocity: vel(v, sec.gain),
          });
        }
      }
      return;
    }
    const pat = BAR_PATTERNS[sec.drums] ?? BAR_PATTERNS.basic!;
    const g = sec.gain;
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.startBar + b;
      const base = bar * beatsPerBar;
      if (!loop && bar === totalBars - 1 && totalBars > 1) {
        // 終止は曲ごとに形を変える
        const mid = Math.floor(beatsPerBar / 2);
        const hit = (drum: keyof typeof GM_DRUMS, step: number, v: number) =>
          notes.push({
            pitch: GM_DRUMS[drum],
            start: base + step,
            duration: 0.25,
            velocity: vel(v, g),
          });
        if (ending === "stop") {
          hit("kick", 0, 110);
          hit("crash", 0, 95);
        } else if (ending === "ring") {
          hit("kick", 0, 95);
          hit("crash", 0, 90);
        } else if (ending === "hits") {
          for (let s = 0; s < beatsPerBar; s++) {
            if (s === 0) {
              hit("kick", s, 105);
              hit("crash", s, 95);
            } else if (s === beatsPerBar - 1) {
              hit("kick", s, 100);
              hit("crash", s, 85);
            } else if (s % 2 === 1) {
              hit("snare", s, 90);
            } else {
              hit("kick", s, 95);
            }
          }
        } else {
          hit("kick", 0, 105);
          hit("crash", 0, 95);
          hit("snare", mid, 90);
          hit("kick", mid, 100);
          hit("crash", mid, 80);
        }
        continue;
      }
      // セクション境界の直前と、曲の最終小節の直前はフィル
      const isPreEnding = !loop && bar === totalBars - 2 && totalBars >= 3;
      // ループ用は最終小節の最後でフィルを打ち、次の周へ渡す
      const isLoopFill = loop && bar === totalBars - 1;
      let isFill =
        (b === sec.bars - 1 && sec.bars >= 2 && si < sections.length - 1) ||
        isPreEnding ||
        isLoopFill;
      // コーパス実測のフィル率に合わせてセクション末尾フィルを確率的に間引く
      // (fillRate 指定時のみ。現行実装は各セクション末尾に必ずフィルを置く)
      if (isFill && rand && opts.fillRate !== undefined) {
        const gate = Math.max(0.1, Math.min(1, opts.fillRate / 0.2));
        isFill = rand() < gate;
      }
      // 4小節周期の中間ターンアラウンド (8小節セクションの4小節目など、セクション末尾以外の4小節区切り)
      const isMidTurnaround = Boolean(rand) && !isFill && beatsPerBar >= 4 && b % 4 === 3 && b < sec.bars - 1;
      // ビルドアップ区間: prechorus または swell > 0 の最終小節
      const isBuildUpBar = Boolean(rand) && (sec.role === "prechorus" || sec.swell > 0) && b === sec.bars - 1 && beatsPerBar >= 4;
      // 2拍フィルを使うか (seed指定時、4小節以上のセクション末尾やサビ突入前など)
      const nextSec = sections[si + 1];
      const useTwoBeatFill =
        Boolean(rand) &&
        isFill &&
        beatsPerBar >= 4 &&
        (sec.bars >= 4 || nextSec?.role === "chorus" || sec.role === "prechorus" || isPreEnding);
      const fillSpanBeats = isFill ? (useTwoBeatFill ? 2 : 1) : isMidTurnaround ? 1 : 0;

      // セクション役割ごとのグルーヴ進化モード (seed指定時のみ有効化し、既存テスト互換を保つ)
      const isChorusLike = Boolean(rand) && (sec.role === "chorus" || sec.role === "solo" || sec.gain > 1);
      const isBridgeLike = Boolean(rand) && (sec.role === "bridge" || sec.role === "interlude");
      const isSecondHalf = Boolean(rand) && sec.bars >= 6 && b >= Math.floor(sec.bars / 2);

      // 休止セクションはフィルと区切りだけ残す
      const sparse = sec.role === "break";
      if (!sparse && !isBuildUpBar) {
        for (const [step, drum, v] of pat) {
          const start = base + step / 4;
          if (start >= base + beatsPerBar) continue;
          // フィルや中間ターンアラウンド区間では邪魔になるキック・スネア・ハットを空ける
          if (
            fillSpanBeats > 0 &&
            start >= base + beatsPerBar - fillSpanBeats &&
            (drum === "kick" || drum === "snare" || (useTwoBeatFill && drum === "closedHat"))
          ) {
            continue;
          }

          let actualDrum: keyof typeof GM_DRUMS = drum;
          let actualVel = v;

          if (rand) {
            // サビ (chorus/solo) や長尺セクション後半ではクローズドハットをライドやオープンハットへ展開し、高揚感を出す
            if (drum === "closedHat") {
              if (isChorusLike && step % 4 === 0) {
                actualDrum = "ride";
                actualVel = Math.min(115, v + 12);
              } else if (isChorusLike && (step === 6 || step === 14)) {
                actualDrum = "openHat";
                actualVel = Math.min(110, v + 8);
              } else if (isSecondHalf && step === 14) {
                actualDrum = "openHat";
                actualVel = Math.min(105, v + 6);
              }
            }
            // ブリッジでは裏拍やスネアの表情を変えてコントラストを作る
            if (isBridgeLike && drum === "closedHat" && step % 4 === 2) {
              actualDrum = "ride";
            }
            // ハイハットの16分/8分ベロシティに自然な強弱グルーヴ (拍頭 > 8分裏 > 16分裏) を付与
            if (actualDrum === "closedHat" || actualDrum === "ride") {
              const grooveMul = step % 4 === 0 ? 1.08 : step % 2 === 0 ? 0.94 : 0.82;
              actualVel = Math.round(actualVel * grooveMul);
            }
          }

          notes.push({
            pitch: GM_DRUMS[actualDrum],
            start,
            duration: 0.25,
            velocity: vel(actualVel, g),
          });
        }

        // seed指定時: 4小節周期のフレーズ展開 (2小節目のアンサー、3小節目の推進キック、4小節目の中間フィル)
        if (rand && !isFill && beatsPerBar >= 4) {
          const phrasePos = b % 4;
          if (phrasePos === 1) {
            // 2小節目 (アンサー小節): シンコペーション・キック (step 6 または step 11) + 4拍目裏のゴーストスネア/オープンハット
            notes.push({
              pitch: GM_DRUMS.kick,
              start: base + 2.75,
              duration: 0.25,
              velocity: vel(84, g),
            });
            notes.push({
              pitch: isChorusLike ? GM_DRUMS.openHat : GM_DRUMS.snare,
              start: base + 3.5,
              duration: 0.25,
              velocity: vel(isChorusLike ? 78 : 48, g),
            });
          } else if (phrasePos === 2 && (isChorusLike || isSecondHalf)) {
            // 3小節目: サビや後半では1拍目裏(step 3)または3拍目裏(step 10)にダブルキックを入れて推進力を上げる
            notes.push({
              pitch: GM_DRUMS.kick,
              start: base + 2.5,
              duration: 0.25,
              velocity: vel(88, g),
            });
            notes.push({
              pitch: GM_DRUMS.snare,
              start: base + 1.75,
              duration: 0.25,
              velocity: vel(44, g),
            });
          } else if (isMidTurnaround) {
            // 4小節目 (中間ターンアラウンド): 4拍目にスネア+タム+オープンハットの小フィルを入れて5小節目へ繋ぐ
            notes.push(
              { pitch: GM_DRUMS.snare, start: base + beatsPerBar - 1, duration: 0.25, velocity: vel(82, g) },
              { pitch: GM_DRUMS.tomHigh, start: base + beatsPerBar - 0.75, duration: 0.25, velocity: vel(86, g) },
              { pitch: GM_DRUMS.tomLow, start: base + beatsPerBar - 0.5, duration: 0.25, velocity: vel(90, g) },
              { pitch: GM_DRUMS.openHat, start: base + beatsPerBar - 0.25, duration: 0.25, velocity: vel(88, g) },
            );
          }
        }
      }

      // prechorus / swell > 0 の最終小節ビルドアップ (スネア+フロアタム+キックの8分/16分クレッシェンド)
      if (isBuildUpBar) {
        notes.push({ pitch: GM_DRUMS.crash, start: base, duration: 1, velocity: vel(85, g) });
        for (let i = 0; i < 8; i++) {
          const stepStart = base + i * 0.5;
          if (stepStart >= base + beatsPerBar - (isFill ? 1 : 0)) break;
          const buildVel = 58 + i * 7;
          notes.push(
            { pitch: GM_DRUMS.snare, start: stepStart, duration: 0.25, velocity: vel(buildVel, g) },
            { pitch: i % 2 === 0 ? GM_DRUMS.kick : GM_DRUMS.tomLow, start: stepStart, duration: 0.25, velocity: vel(buildVel - 4, g) },
          );
        }
      }

      if (isFill) {
        // seed指定時はセクション遷移ごとに異なるフィル (6種類、1拍〜2拍) を選択
        const fillType = rand ? (Math.floor(rand() * 6) + si) % 6 : 0;
        if (useTwoBeatFill && fillType >= 2) {
          const fBase = base + beatsPerBar - 2;
          if (fillType === 2) {
            // 2拍: 3+3+2 シンコペーション・タム＆スネア・ロックフィル
            const seq: [number, keyof typeof GM_DRUMS, number][] = [
              [0, "snare", 86], [0.25, "snare", 72], [0.5, "tomHigh", 90], [0.75, "kick", 94],
              [1.0, "snare", 94], [1.25, "tomHigh", 96], [1.5, "tomLow", 100], [1.75, "tomLow", 106],
            ];
            for (const [ofs, d, fv] of seq) {
              notes.push({ pitch: GM_DRUMS[d], start: fBase + ofs, duration: 0.25, velocity: vel(fv, g) });
            }
          } else if (fillType === 3) {
            // 2拍: フル・タムパノラマ (スネア -> ハイタム -> ロータム -> オープンハット)
            const seq: [number, keyof typeof GM_DRUMS, number][] = [
              [0, "kick", 96], [0, "snare", 84], [0.25, "snare", 88], [0.5, "tomHigh", 90], [0.75, "tomHigh", 94],
              [1.0, "kick", 96], [1.25, "tomLow", 96], [1.5, "tomLow", 102], [1.75, "snare", 108],
            ];
            for (const [ofs, d, fv] of seq) {
              notes.push({ pitch: GM_DRUMS[d], start: fBase + ofs, duration: 0.25, velocity: vel(fv, g) });
            }
          } else if (fillType === 4) {
            // 2拍: 80s アーケード・ストップ＆ロール (3拍目キメ -> 16分スネア+タム連打)
            notes.push(
              { pitch: GM_DRUMS.kick, start: fBase, duration: 0.25, velocity: vel(104, g) },
              { pitch: GM_DRUMS.openHat, start: fBase, duration: 0.5, velocity: vel(90, g) },
              { pitch: GM_DRUMS.snare, start: fBase + 0.75, duration: 0.25, velocity: vel(78, g) },
              { pitch: GM_DRUMS.snare, start: fBase + 1.0, duration: 0.25, velocity: vel(86, g) },
              { pitch: GM_DRUMS.snare, start: fBase + 1.25, duration: 0.25, velocity: vel(94, g) },
              { pitch: GM_DRUMS.tomHigh, start: fBase + 1.5, duration: 0.25, velocity: vel(100, g) },
              { pitch: GM_DRUMS.tomLow, start: fBase + 1.75, duration: 0.25, velocity: vel(106, g) },
            );
          } else {
            // 2拍: 16分スネアロール・クレッシェンド
            for (let i = 0; i < 8; i++) {
              notes.push({
                pitch: i === 7 ? GM_DRUMS.tomLow : GM_DRUMS.snare,
                start: fBase + i * 0.25,
                duration: 0.25,
                velocity: vel(54 + i * 8, g),
              });
            }
          }
        } else if (fillType === 1) {
          // 1拍: スネアクレッシェンド
          for (let i = 0; i < 4; i++) {
            notes.push({
              pitch: GM_DRUMS.snare,
              start: base + beatsPerBar - 1 + i * 0.25,
              duration: 0.25,
              velocity: vel(60 + i * 15, g),
            });
          }
        } else if (fillType === 2) {
          // 1拍: キック+スネア+タム同期シンコペーション
          notes.push(
            { pitch: GM_DRUMS.kick, start: base + beatsPerBar - 1, duration: 0.25, velocity: vel(95, g) },
            { pitch: GM_DRUMS.snare, start: base + beatsPerBar - 0.75, duration: 0.25, velocity: vel(85, g) },
            { pitch: GM_DRUMS.snare, start: base + beatsPerBar - 0.5, duration: 0.25, velocity: vel(90, g) },
            { pitch: GM_DRUMS.tomLow, start: base + beatsPerBar - 0.25, duration: 0.25, velocity: vel(95, g) },
          );
        } else {
          // 1拍 (既定): スネア×2 -> ハイタム -> ロータム
          for (let i = 0; i < 4; i++) {
            const pitch =
              i < 2
                ? GM_DRUMS.snare
                : i === 2
                  ? GM_DRUMS.tomHigh
                  : GM_DRUMS.tomLow;
            notes.push({
              pitch,
              start: base + beatsPerBar - 1 + i * 0.25,
              duration: 0.25,
              velocity: vel(70 + i * 10, g),
            });
          }
        }
      }
      // セクション先頭、または長尺サビの5小節目頭 (中間ターンアラウンド直後) にクラッシュシンバル
      if (b === 0 || (Boolean(rand) && b === 4 && sec.bars >= 6 && isChorusLike))
        notes.push({
          pitch: GM_DRUMS.crash,
          start: base,
          duration: 1,
          velocity: vel(b === 0 ? 85 : 78, g),
        });
    }
  });
  if (rand)
    for (const n of notes)
      n.velocity = Math.max(1, Math.min(127, n.velocity + human()));
  return notes;
}
