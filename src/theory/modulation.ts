/**
 * 転調の知識: 近親調、ピボット和音、転調のアプローチ。
 * 生成パイプラインにはまだ組み込まず、解析・提案用のライブラリとして提供する。
 */

import {
  degreeChord,
  degreePc,
  diatonicTriad,
  keyName,
  parseKeyName,
  type KeyContext,
  type Triad,
} from "./key";
import { analyzeChord } from "./roman";

export type PivotChord = { symbol: string; fromNumeral: string; toNumeral: string };

export type RelatedKey = { key: KeyContext; relation: string };

export type ModulationSuggestion = {
  from: string;
  to: string;
  pivots: PivotChord[];
  recommended: PivotChord | null;
  approach: string;
};

const asKey = (key: KeyContext | string): KeyContext => (typeof key === "string" ? parseKeyName(key) : key);

type Entry = { pc: number; triad: Triad; degree: number };

/** その調の三和音 (短調は和声短調の V / vii° も含む) */
function triadsOf(key: KeyContext): Entry[] {
  const out: Entry[] = [];
  for (let degree = 1; degree <= 7; degree++) {
    out.push({ pc: degreePc(key, degree), triad: diatonicTriad(key, degree), degree });
  }
  if (key.mode === "minor") {
    out.push({ pc: degreePc(key, 5), triad: "maj", degree: 5 });
    out.push({ pc: degreePc(key, 7), triad: "dim", degree: 7 });
  }
  return out;
}

/** 両方の調で同じ和音として使えるピボット和音 */
export function pivotChords(from: KeyContext | string, to: KeyContext | string): PivotChord[] {
  const a = asKey(from);
  const b = asKey(to);
  const target = triadsOf(b);
  const seen = new Set<string>();
  const out: PivotChord[] = [];
  for (const entry of triadsOf(a)) {
    const match = target.find((t) => t.pc === entry.pc && t.triad === entry.triad);
    if (!match) continue;
    const symbol = degreeChord(a, entry.degree, entry.triad);
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({
      symbol,
      fromNumeral: analyzeChord(symbol, a).numeral,
      toNumeral: analyzeChord(symbol, b).numeral,
    });
  }
  return out;
}

/** 近親調 (属調・下属調・平行調・同主調) */
export function closelyRelatedKeys(key: KeyContext | string): RelatedKey[] {
  const k = asKey(key);
  if (k.mode === "major") {
    return [
      { key: { root: (k.root + 7) % 12, mode: "major" }, relation: "dominant" },
      { key: { root: (k.root + 5) % 12, mode: "major" }, relation: "subdominant" },
      { key: { root: (k.root + 9) % 12, mode: "minor" }, relation: "relative minor" },
      { key: { root: k.root, mode: "minor" }, relation: "parallel minor" },
    ];
  }
  return [
    { key: { root: (k.root + 7) % 12, mode: "minor" }, relation: "dominant minor" },
    { key: { root: (k.root + 5) % 12, mode: "minor" }, relation: "subdominant minor" },
    { key: { root: (k.root + 3) % 12, mode: "major" }, relation: "relative major" },
    { key: { root: k.root, mode: "major" }, relation: "parallel major" },
  ];
}

/** 新調で ii / IV / V になるピボットを優先する */
function rank(pivot: PivotChord): number {
  if (pivot.toNumeral.startsWith("ii")) return 0;
  if (pivot.toNumeral.startsWith("IV")) return 1;
  if (pivot.toNumeral.startsWith("V")) return 2;
  return 3;
}

export function suggestModulation(from: KeyContext | string, to: KeyContext | string): ModulationSuggestion {
  const a = asKey(from);
  const b = asKey(to);
  const pivots = pivotChords(a, b);
  const recommended = [...pivots].sort((x, y) => rank(x) - rank(y))[0] ?? null;
  const approach = recommended
    ? `Pivot on ${recommended.symbol} (${recommended.fromNumeral} in ${keyName(a)} = ${recommended.toNumeral} in ${keyName(b)}), then approach the new tonic with its V7.`
    : `No shared triad; use a direct modulation or a dominant preparation in ${keyName(b)}.`;
  return { from: keyName(a), to: keyName(b), pivots, recommended, approach };
}
