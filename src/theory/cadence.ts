/** カデンツ (終止形) の検出 */

import type { Analysis } from "./roman";

export type CadenceType = "PAC" | "IAC" | "HC" | "PC" | "DC" | "none";

const isDegree = (a: Analysis, d: number) => a.degree === d && a.accidental === 0;
const isDominant = (a: Analysis) => isDegree(a, 5) && a.fn === "D";
/** I7 (ブルースのトニック) もトニックとして扱う */
const isTonic = (a: Analysis) => isDegree(a, 1);

/**
 * 直前の和音 → 最後の和音 で終止を判定する。
 * メロディを持たない段階のため、PAC / IAC は転回形だけで近似する
 * (本来の PAC はソプラノが主音に解決することも条件)。
 */
export function detectCadence(prev: Analysis, last: Analysis): CadenceType {
  if (isDominant(prev) && isTonic(last)) {
    return prev.inversion === 0 && last.inversion === 0 ? "PAC" : "IAC";
  }
  if (isDominant(last)) return "HC";
  if (isDegree(prev, 4) && isTonic(last)) return "PC";
  if (isDominant(prev) && isDegree(last, 6)) return "DC";
  return "none";
}

/**
 * 最後の和音が同じ記号で伸ばされている場合 (C–C など) は、
 * 直前の「変化」を終止として見る。
 */
export function cadenceAt(analyses: Analysis[]): CadenceType {
  if (analyses.length < 2) return "none";
  const last = analyses[analyses.length - 1]!;
  let i = analyses.length - 2;
  while (i >= 0 && analyses[i]!.numeral === last.numeral) i--;
  return i < 0 ? "none" : detectCadence(analyses[i]!, last);
}
