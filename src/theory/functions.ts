/** 機能和声: トニック / サブドミナント / ドミナント の分類と逆行判定 */

import { baseTriad, type ChordQuality, type Mode } from "./key";

export type Function = "T" | "S" | "D";

/** 長調: I ii iii IV V vi vii° */
const MAJOR_FUNCTIONS: Function[] = ["T", "S", "T", "S", "D", "T", "D"];
/** 短調: i ii° III iv v VI VII */
const MINOR_FUNCTIONS: Function[] = ["T", "S", "T", "S", "D", "S", "D"];

/**
 * 度数の機能を返す。借用和音は「元の度数」ではなく和音の役割で決める。
 * 例: bVII は長調では S (ミクソリディアン的)、bIII は T。
 */
export function functionOf(degree: number, accidental: -1 | 0 | 1, quality: ChordQuality, mode: Mode): Function {
  if (accidental === 0) {
    return (mode === "major" ? MAJOR_FUNCTIONS : MINOR_FUNCTIONS)[degree - 1]!;
  }
  if (accidental === 1 && degree === 7 && mode === "minor") return "D"; // 導音 (vii°)
  if (accidental === -1) {
    if (degree === 2) return "S"; // bII (ナポリ)
    if (degree === 3) return "T"; // bIII
    if (degree === 6) return "S"; // bVI
    if (degree === 7) return "S"; // bVII
    return "S";
  }
  if (accidental === 1 && degree === 4) return "S"; // #IV
  return baseTriad(quality) === "dim" ? "D" : "S";
}

/**
 * D → S は機能の逆行 (例: V → IV)。ポップスでは意図的な使用もあるため warn 扱い。
 * ただし二次ドミナント (V7/x) が対象 x へ解決する場合は逆行ではない。
 */
export function isRetrogression(
  prev: { fn: Function; degree?: number; appliedTo?: number },
  next: { fn: Function; degree?: number },
): boolean {
  if (prev.fn !== "D" || next.fn !== "S") return false;
  if (prev.appliedTo !== undefined && prev.appliedTo === next.degree) return false;
  return true;
}
