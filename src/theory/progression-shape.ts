/**
 * プランの「Aセクションのコード進行の骨格」を取り出し、
 * 使い古された定番進行かどうかを判定する。
 * 反復生成で同じ進行になるのを防ぐためのガード。
 */

import type { Plan } from "../plan";
import { parseKeyName } from "./key";
import { analyzeChord } from "./roman";

/** 骨格として比較する定番進行 (ローマ数字、循環一致で判定) */
export const COMMON_SKELETONS: readonly (readonly string[])[] = [
  ["I", "V", "vi", "IV"],   // 1564
  ["vi", "IV", "I", "V"],   // 6415
  ["IV", "V", "iii", "vi"], // 王道進行
  ["I", "vi", "ii", "V"],   // 1625
  ["I", "IV", "V", "I"],    // 1451
];

/** プロンプトが特定の進行を名指ししているか (名指しなら定番でも許可) */
export function requestNamesProgression(prompt: string): boolean {
  return /王道進行|小室進行|丸サ|カノン|4536|1564|6415|1625|1645|ii-?V-?I|2-?5-?1|ツーファイブ|ブルース|12小節|12-bar|12 bar|アンダルシア|50s|ドゥーワップ/i
    .test(prompt);
}

/** ローマ数字から度数だけ取り出す (V7 → V, Imaj7 → I)。二次ドミナント等は null */
function degreeOf(numeral: string): string | null {
  if (numeral.includes("/")) return null; // V7/V などは彩りとして扱い、定番判定しない
  const m = /^([b#]?[ivIV]+)/.exec(numeral);
  return m ? m[1]! : null;
}

/**
 * Aセクション (先頭セクション) の度数列を返す。
 * 同じ度数の連続は1つにまとめ、解釈できないコードや二次ドミナントを含む場合は
 * 定番判定できないため空配列を返す。
 */
export function sectionSkeleton(plan: Plan, bars: number): string[] {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const firstSectionBars = plan.sections[0]?.bars ?? Math.min(4, bars);
  const limitBeats = Math.max(beatsPerBar, Math.min(bars, firstSectionBars) * beatsPerBar);
  const key = parseKeyName(plan.key);
  const degrees: string[] = [];
  for (const [beat, symbol] of [...plan.chords].sort((a, b) => a[0] - b[0])) {
    if (beat >= limitBeats - 1e-6) break;
    let analyzed;
    try {
      analyzed = analyzeChord(symbol, key);
    } catch {
      return [];
    }
    const degree = degreeOf(analyzed.numeral);
    if (degree === null) return [];
    degrees.push(degree);
  }
  // 連続重複を除去
  const out: string[] = [];
  for (const d of degrees) if (out.length === 0 || out[out.length - 1] !== d) out.push(d);
  return out;
}

/** 循環一致で定番進行か判定する */
export function isCommonSkeleton(skeleton: string[]): boolean {
  if (skeleton.length < 3) return false;
  for (const banned of COMMON_SKELETONS) {
    if (banned.length !== skeleton.length) continue;
    for (let shift = 0; shift < skeleton.length; shift++) {
      if (banned.every((x, i) => skeleton[(i + shift) % skeleton.length] === x)) return true;
    }
  }
  return false;
}

export type RepetitionVerdict = {
  /** 判定に使った骨格 (空 = 判定不能) */
  skeleton: string[];
  /** 定番進行そのものか */
  common: boolean;
};

/** プランが「使い古された定番進行」かどうかを判定する */
export function checkCommonProgression(plan: Plan, bars: number, prompt: string): RepetitionVerdict {
  const skeleton = sectionSkeleton(plan, bars);
  if (requestNamesProgression(prompt)) return { skeleton, common: false };
  return { skeleton, common: isCommonSkeleton(skeleton) };
}
