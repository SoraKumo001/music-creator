/**
 * 多様性評価: 同じプロンプトからN曲作ったときに「毎回同じ」になっていないか測る。
 * ネットワークは使わない。Plan JSON の配列から決定的に計算する。
 */

import { cadenceAt } from "../theory/cadence";
import { parseKeyName } from "../theory/key";
import { analyzeChord } from "../theory/roman";
import type { Plan } from "../plan";

export type DiversityInput = { name: string; bars: number; plan: Plan };

export type DiversitySummary = {
  count: number;
  /** 進行シグネチャ (コード列) の重複なし率。1に近いほどバラバラ */
  distinctProgressionRate: number;
  /** 調の種類数 / 全体 */
  keyVariety: number;
  /** BPMの標準偏差 */
  bpmStddev: number;
  /** 1プランあたり平均コード数 */
  avgChords: number;
  /** 終止形の種類数 (PAC/IAC/HC/PC/DC/none のうち出現したもの) */
  cadenceVariety: number;
  /** 終止形の分布 */
  cadenceHistogram: Record<string, number>;
};

const signature = (plan: Plan) => plan.chords.map(([, s]) => s).join("|");

export function evaluateDiversity(inputs: DiversityInput[]): DiversitySummary {
  const n = inputs.length;
  if (n === 0) {
    return {
      count: 0, distinctProgressionRate: 0, keyVariety: 0,
      bpmStddev: 0, avgChords: 0, cadenceVariety: 0, cadenceHistogram: {},
    };
  }
  const sigs = inputs.map(({ plan }) => signature(plan));
  const distinctProgressionRate = new Set(sigs).size / n;
  const keyVariety = new Set(inputs.map(({ plan }) => `${plan.key}@${plan.timeSignature.join("/")}`)).size / n;
  const bpms = inputs.map(({ plan }) => plan.bpm);
  const mean = bpms.reduce((a, b) => a + b, 0) / n;
  const bpmStddev = Math.sqrt(bpms.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const avgChords = inputs.reduce((a, { plan }) => a + plan.chords.length, 0) / n;

  const cadenceHistogram: Record<string, number> = {};
  for (const { plan } of inputs) {
    const key = parseKeyName(plan.key);
    const analyses = [...plan.chords]
      .sort((a, b) => a[0] - b[0])
      .map(([, s]) => { try { return analyzeChord(s, key); } catch { return null; } })
      .filter((a) => a !== null);
    const cad = analyses.length >= 2 ? cadenceAt(analyses) : "none";
    cadenceHistogram[cad] = (cadenceHistogram[cad] ?? 0) + 1;
  }
  return {
    count: n, distinctProgressionRate, keyVariety, bpmStddev,
    avgChords: Math.round(avgChords * 100) / 100,
    cadenceVariety: Object.keys(cadenceHistogram).length,
    cadenceHistogram,
  };
}
