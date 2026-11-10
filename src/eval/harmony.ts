/**
 * 和声評価: プランの検証・補正前後の指標をまとめる。
 * ネットワークは使わない (フィクスチャ専用)。CLI は scripts/eval-harmony.ts。
 */

import type { Plan } from "../plan";
import { cadenceAt, type CadenceType } from "../theory/cadence";
import { parseKeyName } from "../theory/key";
import { repairPlan } from "../theory/repair";
import { analyzeChord } from "../theory/roman";
import { validatePlan } from "../theory/validate";

export type EvalFixture = { name: string; bars: number; plan: Plan };

export type EvalRow = {
  name: string;
  bars: number;
  issuesBefore: number;
  issuesAfter: number;
  errorsAfter: number;
  repairs: number;
  cadence: CadenceType;
  endingTonic: boolean;
  /** 調内 (借用・二次ドミナントを含む) の和音の割合 */
  diatonic: number;
};

export type EvalSummary = {
  count: number;
  cadenceRate: number;
  endingTonicRate: number;
  diatonicRate: number;
  errorRateAfter: number;
  avgIssuesBefore: number;
  avgIssuesAfter: number;
  repairs: number;
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function evaluateFixture(fixture: EvalFixture): EvalRow {
  const before = validatePlan(fixture.plan, fixture.bars);
  const repaired = repairPlan(fixture.plan, fixture.bars);
  const after = validatePlan(repaired.plan, fixture.bars);

  const key = parseKeyName(repaired.plan.key);
  const chords = [...repaired.plan.chords].sort((a, b) => a[0] - b[0]);
  const analyses = chords.map(([, symbol]) => analyzeChord(symbol, key));
  const last = analyses[analyses.length - 1];
  const cadence: CadenceType = cadenceAt(analyses);
  const explainable = analyses.filter(
    (a) => a.isDiatonic || a.borrowedFrom !== undefined || a.appliedTo !== undefined,
  ).length;

  return {
    name: fixture.name,
    bars: fixture.bars,
    issuesBefore: before.length,
    issuesAfter: after.length,
    errorsAfter: after.filter((i) => i.severity === "error").length,
    repairs: repaired.fixes.length,
    cadence,
    endingTonic: last !== undefined && last.degree === 1 && last.accidental === 0,
    diatonic: analyses.length === 0 ? 0 : explainable / analyses.length,
  };
}

export function evaluateAll(fixtures: EvalFixture[]): { rows: EvalRow[]; summary: EvalSummary } {
  const rows = fixtures.map(evaluateFixture);
  const n = rows.length;
  return {
    rows,
    summary: {
      count: n,
      cadenceRate: n === 0 ? 0 : rows.filter((r) => r.cadence !== "none").length / n,
      endingTonicRate: n === 0 ? 0 : rows.filter((r) => r.endingTonic).length / n,
      diatonicRate: mean(rows.map((r) => r.diatonic)),
      errorRateAfter: n === 0 ? 0 : rows.filter((r) => r.errorsAfter > 0).length / n,
      avgIssuesBefore: mean(rows.map((r) => r.issuesBefore)),
      avgIssuesAfter: mean(rows.map((r) => r.issuesAfter)),
      repairs: rows.reduce((sum, r) => sum + r.repairs, 0),
    },
  };
}
