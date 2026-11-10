/**
 * リハーモナイズ: 既存の進行に対して、機能を保った和音の代替案を出す。
 * メロディとの衝突は見ない (和声の選択肢を示すための提案)。
 */

import type { Plan } from "../plan";
import {
  degreeChord,
  diatonicSeventh,
  diatonicTriad,
  parseKeyName,
  type ChordQuality,
  type KeyContext,
} from "./key";
import { analyzeChord } from "./roman";

export type Substitution = { symbol: string; reason: string };
export type ReharmSuggestion = { beat: number; original: string; numeral: string; alternatives: Substitution[] };

/** 同じ機能の度数 (T: I/iii/vi, S: ii/IV, D: V/vii°) */
const FAMILY: Record<number, number[]> = {
  1: [3, 6],
  2: [4],
  3: [1, 6],
  4: [2],
  5: [7],
  6: [1, 3],
  7: [5],
};

const SEVENTHS = new Set<ChordQuality>(["maj7", "min7", "dom7", "m7b5", "dim7", "dom9", "maj9", "min9"]);

function chordForDegree(key: KeyContext, degree: number, seventh: boolean): string {
  if (key.mode === "minor" && degree === 5) return degreeChord(key, 5, seventh ? "dom7" : "maj");
  if (key.mode === "minor" && degree === 7) return degreeChord(key, 7, seventh ? "dim7" : "dim");
  return degreeChord(key, degree, seventh ? diatonicSeventh(key, degree) : diatonicTriad(key, degree));
}

/** 1 和音に対する代替案。調内の和音だけを対象にする */
export function substitutionsFor(symbol: string, key: KeyContext | string): Substitution[] {
  const k = typeof key === "string" ? parseKeyName(key) : key;
  const a = analyzeChord(symbol, k);
  if (!a.isDiatonic) return [];

  const seventh = a.quality !== "other" && SEVENTHS.has(a.quality);
  const out: Substitution[] = [];
  for (const degree of FAMILY[a.degree] ?? []) {
    const alt = chordForDegree(k, degree, seventh);
    if (alt === symbol) continue;
    out.push({ symbol: alt, reason: `${a.numeral} -> ${analyzeChord(alt, k).numeral} (same function)` });
  }
  if (a.degree === 5 && (a.quality === "dom7" || a.quality === "dom9")) {
    out.push({ symbol: degreeChord(k, 2, "dom7", -1), reason: `${a.numeral} -> bII7 (tritone substitution)` });
  }
  return out;
}

/** 進行全体の代替案。最後のトニックは動かさない */
export function reharmonizePlan(plan: Plan): ReharmSuggestion[] {
  const key = parseKeyName(plan.key);
  const chords = [...plan.chords].sort((x, y) => x[0] - y[0]);
  const out: ReharmSuggestion[] = [];
  chords.forEach(([beat, symbol], i) => {
    const a = analyzeChord(symbol, key);
    if (i === chords.length - 1 && a.degree === 1 && a.accidental === 0) return;
    const alternatives = substitutionsFor(symbol, key);
    if (alternatives.length > 0) out.push({ beat, original: symbol, numeral: a.numeral, alternatives });
  });
  return out;
}
