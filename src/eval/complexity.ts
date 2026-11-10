/**
 * 複雑さ評価: 曲がどれだけ「複雑」かを Plan (+任意で Score) から決定的に測る。
 * 多様性 (diversity.ts) とは別軸。ネットワークは使わない。
 */

import { keyAtBeat, type Complexity, type Plan } from "../plan";
import type { Score } from "../score";
import { parseKeyName } from "../theory/key";
import { analyzeChord } from "../theory/roman";

export type ComplexityInput = { name: string; bars: number; plan: Plan; score?: Score };

export type ComplexitySummary = {
  count: number;
  /** 平均セクション数 */
  avgSections: number;
  /** 平均コード種類数 */
  avgUniqueChords: number;
  /** 借用・二次ドミナントの割合 */
  borrowedRate: number;
  /** 転調ありの曲の割合 */
  modulationRate: number;
  /** 平均トラック数 (score付きのみ) */
  avgTracks: number;
  /** 平均音価種類数 (score付きのみ) */
  avgRhythmVariety: number;
  /** 0-100の総合スコア (目安用) */
  score100: number;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function planMetrics(plan: Plan, bars: number) {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const unique = new Set(plan.chords.map(([, s]) => s));
  let borrowed = 0;
  let analyzed = 0;
  for (const [beat, symbol] of plan.chords) {
    try {
      const a = analyzeChord(symbol, parseKeyName(keyAtBeat(plan, beat, beatsPerBar)));
      analyzed++;
      if (!a.isDiatonic && (a.borrowedFrom !== undefined || a.appliedTo !== undefined)) borrowed++;
    } catch { /* 解析不能は無視 */ }
  }
  return {
    sections: plan.sections.length === 0 ? 1 : plan.sections.length,
    uniqueChords: unique.size,
    borrowedRate: analyzed === 0 ? 0 : borrowed / analyzed,
    modulated: (plan.keyChanges ?? []).filter((kc) => kc.bar > 0 && kc.bar < bars).length > 0,
    swing: plan.swing ?? 0,
  };
}

export function evaluateComplexity(inputs: ComplexityInput[]): ComplexitySummary {
  const n = inputs.length;
  if (n === 0) {
    return {
      count: 0, avgSections: 0, avgUniqueChords: 0, borrowedRate: 0,
      modulationRate: 0, avgTracks: 0, avgRhythmVariety: 0, score100: 0,
    };
  }
  const pm = inputs.map(({ plan, bars }) => planMetrics(plan, bars));
  const avgSections = pm.reduce((a, m) => a + m.sections, 0) / n;
  const avgUniqueChords = pm.reduce((a, m) => a + m.uniqueChords, 0) / n;
  const borrowedRate = pm.reduce((a, m) => a + m.borrowedRate, 0) / n;
  const modulationRate = pm.filter((m) => m.modulated).length / n;

  const scored = inputs.filter((i) => i.score !== undefined);
  let avgTracks = 0;
  let avgRhythmVariety = 0;
  if (scored.length > 0) {
    avgTracks = scored.reduce((a, i) => a + i.score!.tracks.length, 0) / scored.length;
    avgRhythmVariety = scored.reduce((a, i) => {
      const durs = new Set(i.score!.tracks.flatMap((t) => t.notes.map((x) => Math.round(x.duration * 8))));
      return a + durs.size;
    }, 0) / scored.length;
  }
  // 総合スコア: セクション3+ / コード6種+ / 借用あり / 転調 / トラック5+ / 音価6種 を目安に加算
  const score100 = Math.min(100, Math.round(
    Math.min(20, avgSections * 5) +
    Math.min(25, avgUniqueChords * 4) +
    borrowedRate * 20 +
    modulationRate * 15 +
    Math.min(10, Math.max(0, avgTracks - 4) * 5) +
    Math.min(10, Math.max(0, avgRhythmVariety - 3) * 2),
  ));
  return {
    count: n,
    avgSections: round2(avgSections),
    avgUniqueChords: round2(avgUniqueChords),
    borrowedRate: round2(borrowedRate),
    modulationRate: round2(modulationRate),
    avgTracks: round2(avgTracks),
    avgRhythmVariety: round2(avgRhythmVariety),
    score100,
  };
}

/** complexity レベル別の目安 */
export const COMPLEXITY_TARGET: Record<Complexity, string> = {
  simple: "sections<=2, diatonic, no modulation",
  standard: "current behavior",
  rich: "3+ sections, borrowing, optional modulation and counter-melody",
};
