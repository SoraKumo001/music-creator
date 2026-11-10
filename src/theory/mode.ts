/**
 * モード (長調/短調) の強制。
 *
 * 生成パイプラインはプロンプトの Variation ブロックで長調/短調を明示するが、
 * LLM がそれでも逆のモードを返した場合の決定的フォールバックとして、
 * 和音のローマ数字 (度数・借用・品質) を保ったまま同主調へ実現し直す。
 */

import { keyAtBeat, type Plan } from "../plan";
import { parseChord } from "./harmony";
import {
  acceptedTriads,
  baseTriad,
  degreeChord,
  diatonicSeventh,
  diatonicTriad,
  keyName,
  parseKeyName,
  pcName,
  prefersFlat,
  type ChordQuality,
  type KeyContext,
  type Mode,
} from "./key";
import { analyzeChord, type Analysis } from "./roman";

/** 7th 系の品質 (対象調のダイアトニック 7th へ置き換える) */
const SEVENTH_FAMILY = new Set<ChordQuality>(["maj7", "min7", "dom7", "m7b5", "dim7", "minMaj7"]);
/** 3度を持たない和音は品質をそのまま保つ */
const NO_THIRD = new Set<ChordQuality>(["sus4", "sus2", "five"]);

/** ローカル調から対象モードへ1和音を実現し直す */
function parallelQuality(a: Analysis, target: KeyContext): ChordQuality {
  const q: ChordQuality = a.quality === "other" ? "maj" : a.quality;
  if (NO_THIRD.has(q)) return q;
  // 6th 和音は 3度だけを対象調のダイアトニックに合わせ、6度は保つ
  if (q === "six" || q === "minSix") return diatonicTriad(target, a.degree) === "min" ? "minSix" : "six";
  // dim 系は vii°/ii° として調内に残せる場合だけ品質を保つ (それ以外は通常の三和音/7th へ)
  if (baseTriad(q) === "dim" && acceptedTriads(target, a.degree).includes("dim")) return q;
  if (SEVENTH_FAMILY.has(q)) return diatonicSeventh(target, a.degree);
  const triad = baseTriad(q);
  if (acceptedTriads(target, a.degree).includes(triad)) return triad;
  // そのモードでは同じ三和音が調内にない (例: 短調の III(長三和音) → 長調の iii(短三和音))
  return diatonicTriad(target, a.degree);
}

/** 1和音を、指定モードの同じ主音の調へ実現し直す (分数コードは構成音に含まれる場合だけ維持) */
function realizeParallel(symbol: string, local: KeyContext, mode: Mode): string {
  if (local.mode === mode) return symbol;
  let analysis: Analysis;
  try {
    analysis = analyzeChord(symbol, local);
  } catch {
    return symbol;
  }
  // 借用和音・二次ドミナント・裏コード・9th 等 (analyzeChord が other を返すものを含む) は
  // モードに依存しない色彩なので、同じ記号のまま使う
  if (!analysis.isDiatonic) return symbol;
  const target: KeyContext = { root: local.root, mode };
  // 短調の導音 (vii°) は長調では調内の vii° と同じ音になるため、b/# の補正を外す
  // (逆方向: 長調の vii° を短調へ移すときは導音を明示する)
  let accidental: -1 | 0 | 1 = analysis.accidental;
  const triad = baseTriad(analysis.quality === "other" ? "maj" : analysis.quality);
  if (local.mode === "minor" && mode === "major" && analysis.degree === 7) accidental = 0;
  if (local.mode === "major" && mode === "minor" && analysis.degree === 7 && triad === "dim") accidental = 1;
  let out = degreeChord(target, analysis.degree, parallelQuality(analysis, target), accidental);
  try {
    const orig = parseChord(symbol);
    const inversion = (orig.bass - orig.root + 12) % 12;
    if (inversion !== 0) {
      const next = parseChord(out);
      const bassPc = (next.root + inversion) % 12;
      if (next.tones.includes(bassPc)) out += "/" + pcName(bassPc, prefersFlat(target));
    }
  } catch {
    /* 分数コード化に失敗しても本体のコードは有効 */
  }
  return out;
}

/**
 * プラン全体を指定モードへ揃える。主音は変えず、各和音はローマ数字の度数を保って
 * 同主調 (C minor → C major など) へ移す。転調がある場合は各区間のローカル調を同じモードへ揃える。
 */
export function transposePlanToMode(plan: Plan, mode: Mode): Plan {
  const mainKey = parseKeyName(plan.key);
  if (mainKey.mode === mode) return plan;
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  // 和音の実現は「元の調」で解析してから行う (転調区間も元のローカル調が基準)
  const chords = plan.chords.map(([beat, symbol]) => {
    const local = parseKeyName(keyAtBeat(plan, beat, beatsPerBar));
    return [beat, realizeParallel(symbol, local, mode)] as [number, string];
  });
  const keyChanges = (plan.keyChanges ?? []).map((kc) => {
    const local = parseKeyName(kc.key);
    return { ...kc, bar: kc.bar, key: keyName({ root: local.root, mode }) };
  });
  return { ...plan, key: keyName({ root: mainKey.root, mode }), keyChanges, chords };
}

/**
 * 宣言した調のモードと、実際に書かれた和音の響きが食い違っていないかを調べる。
 *
 * 例: キーは C major なのに Cm–Ab–Eb–Bb (並行短調の進行) が書かれていると、
 * validatePlan は借用和音として許容するため「長調の曲」として通り、実際は短調に聴こえる。
 * 並行短調 (長調→短調) / 並行長調 (短調→長調) からの借用が多い場合に警告文を返す。
 */
export function planModeConflict(plan: Plan, targetMode: Mode): string | null {
  if (plan.chords.length === 0) return null;
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  let parallel = 0;
  let parallelTonic = 0;
  let counted = 0;
  for (const [beat, symbol] of plan.chords) {
    const local = parseKeyName(keyAtBeat(plan, beat, beatsPerBar));
    // 転調区間 (メインの調とモードが違う区間) は対象外
    if (local.mode !== targetMode) continue;
    let a: Analysis;
    try {
      a = analyzeChord(symbol, local);
    } catch {
      continue; // 解析不能は数えない
    }
    // 3度を持たない和音 (sus4/sus2/パワーコード) はモード中立なので数えない
    if (a.quality === "sus4" || a.quality === "sus2" || a.quality === "five") continue;
    counted++;
    if (!a.isDiatonic && a.borrowedFrom === (targetMode === "major" ? "parallelMinor" : "parallelMajor")) {
      parallel++;
      // トニックの和音そのものが並行モード (i→I / I→i) になっているか
      if (a.degree === 1 && a.accidental === 0) parallelTonic++;
    }
  }
  if (counted === 0) return null;
  // 借用が多くても、トニックが並行モードで鳴っていなければ
  // (例: C major の I–bVI–bVII–I のようなモーダルな色彩) 響きの主調は長調のままなので許容する
  if (parallelTonic === 0 || parallel / counted < 0.4) return null;
  return targetMode === "major"
    ? `the chords are centred on the parallel minor (${parallel}/${counted} chords are borrowed from it), so the song sounds minor even though the key says ${plan.key}. Rewrite it with the major key's own chords (I, ii, iii, IV, V, vi) and keep I as home.`
    : `the chords are centred on the parallel major (${parallel}/${counted} chords are borrowed from it), so the song sounds major even though the key says ${plan.key}. Rewrite it with the minor key's own chords (i, ii°, III, iv, v, VI, VII) and keep i as home.`;
}
