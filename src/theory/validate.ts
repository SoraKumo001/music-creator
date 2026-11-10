/**
 * 進行の検証。docs/harmony-criteria.md の Issue コードを返す。
 * error は生成のやり直し、warn は repair.ts で補正、info は記録のみ。
 */

import { keyAtBeat, resolveSections, type Plan } from "../plan";
import { cadenceAt } from "./cadence";
import { isRetrogression } from "./functions";
import { parseKeyName } from "./key";
import { analyzeChord, type Analysis } from "./roman";

export type IssueSeverity = "error" | "warn" | "info";

export type IssueCode =
  | "PARSE_ERROR"
  | "KEY_MISMATCH"
  | "NO_TONIC"
  | "NO_CADENCE"
  | "WEAK_ENDING"
  | "RETROGRESSION"
  | "HARMONIC_RHYTHM"
  | "TOO_FEW_CHORDS"
  | "TOO_MANY_CHORDS"
  | "SECTION_CADENCE"
  | "CHROMATIC_UNEXPLAINED"
  | "LOOP_LEAD_IN"
  | "LOOP_TARGET"
  | "MODULATION"
  | "FORM";

export type Issue = {
  code: IssueCode;
  severity: IssueSeverity;
  beat?: number;
  message: string;
  fix?: string;
};

type Parsed = { beat: number; symbol: string; analysis: Analysis };

/** 各コードをその拍で有効な調で解析する (転調対応) */
function parseChords(plan: Plan, beatsPerBar: number): { parsed: Parsed[]; parseErrors: Issue[] } {
  const parseErrors: Issue[] = [];
  const parsed: Parsed[] = [];
  for (const [beat, symbol] of [...plan.chords].sort((a, b) => a[0] - b[0])) {
    try {
      const key = parseKeyName(keyAtBeat(plan, beat, beatsPerBar));
      parsed.push({ beat, symbol, analysis: analyzeChord(symbol, key) });
    } catch {
      parseErrors.push({
        code: "PARSE_ERROR",
        severity: "error",
        beat,
        message: `Unrecognized chord symbol: "${symbol}"`,
        fix: "Use a symbol such as C, Cm7, Fmaj7, G7, Bb, or C/E.",
      });
    }
  }
  return { parsed, parseErrors };
}

/** 設計プランの和声を検証する。bars は要求された曲の長さ */
export function validatePlan(plan: Plan, bars: number): Issue[] {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const total = bars * beatsPerBar;
  const issues: Issue[] = [];

  const { parsed, parseErrors } = parseChords(plan, beatsPerBar);
  issues.push(...parseErrors);
  if (parsed.length === 0) return issues;

  const first = parsed[0]!;
  const last = parsed[parsed.length - 1]!;

  // 宣言した調との整合: 説明できる和音が半分未満なら error
  const explainable = parsed.filter(
    (p) => p.analysis.isDiatonic || p.analysis.borrowedFrom !== undefined || p.analysis.appliedTo !== undefined,
  ).length;
  if (explainable / parsed.length < 0.5) {
    issues.push({
      code: "KEY_MISMATCH",
      severity: "error",
      beat: first.beat,
      message: `Most chords do not fit the declared key (${plan.key}).`,
      fix: "Transpose the progression into the declared key, or change the key.",
    });
  }

  // トニックの有無
  if (!parsed.some((p) => p.analysis.degree === 1 && p.analysis.accidental === 0)) {
    issues.push({
      code: "NO_TONIC",
      severity: "warn",
      beat: first.beat,
      message: "The tonic chord never appears.",
      fix: "Start or end with the tonic.",
    });
  }

  if (plan.loop) {
    // ループ用: 最終和音が導音かトニックなら、次の周へ自然につながる
    const lastIsDominant = last.analysis.fn === "D";
    const lastIsTonic = last.analysis.degree === 1 && last.analysis.accidental === 0;
    if (!lastIsDominant && !lastIsTonic) {
      issues.push({
        code: "LOOP_LEAD_IN",
        severity: "warn",
        beat: last.beat,
        message: `The last chord ${last.symbol} does not lead back into the loop.`,
        fix: "End on V (or a turnaround) so the loop resolves to the first chord.",
      });
    }
    if (!(first.analysis.degree === 1 && first.analysis.accidental === 0)) {
      issues.push({
        code: "LOOP_TARGET",
        severity: "info",
        beat: first.beat,
        message: `The loop starts on ${first.symbol}, not the tonic.`,
        fix: "Start on the tonic so the final V resolves into the loop.",
      });
    }
  } else {
    // 終止
    if (last.analysis.degree !== 1 || last.analysis.accidental !== 0) {
      issues.push({
        code: "WEAK_ENDING",
        severity: "warn",
        beat: last.beat,
        message: `The song ends on ${last.symbol}, not the tonic.`,
        fix: "End on the tonic chord.",
      });
    }

    if (parsed.length >= 2) {
      if (cadenceAt(parsed.map((p) => p.analysis)) === "none") {
        issues.push({
          code: "NO_CADENCE",
          severity: "warn",
          beat: parsed[parsed.length - 2]!.beat,
          message: "No cadence in the last two chords.",
          fix: "Add ii-V-I or V-I at the end.",
        });
      }
    }
  }

  // 機能の逆行 (D -> S)
  for (let i = 0; i + 1 < parsed.length; i++) {
    if (isRetrogression(parsed[i]!.analysis, parsed[i + 1]!.analysis)) {
      issues.push({
        code: "RETROGRESSION",
        severity: "warn",
        beat: parsed[i + 1]!.beat,
        message: `${parsed[i]!.symbol} -> ${parsed[i + 1]!.symbol} moves D -> S.`,
        fix: "Swap the two chords, or add a passing chord.",
      });
    }
  }

  // 和声リズム
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;
    if (!Number.isInteger(p.beat)) {
      issues.push({
        code: "HARMONIC_RHYTHM",
        severity: "info",
        beat: p.beat,
        message: `Chord starts off the beat grid (${p.beat}).`,
        fix: "Snap chord changes to whole beats.",
      });
    }
    const end = i + 1 < parsed.length ? parsed[i + 1]!.beat : total;
    const len = end - p.beat;
    if (len < 1) {
      issues.push({
        code: "HARMONIC_RHYTHM",
        severity: "info",
        beat: p.beat,
        message: `Chord ${p.symbol} lasts less than a beat.`,
        fix: "Merge it into a neighbouring chord.",
      });
    } else if (len > 2 * beatsPerBar) {
      issues.push({
        code: "HARMONIC_RHYTHM",
        severity: "info",
        beat: p.beat,
        message: `Chord ${p.symbol} lasts more than two bars.`,
        fix: "Change chords more often.",
      });
    }
  }

  // コード数 (4 小節あたり 2〜8)
  const per4 = bars / 4;
  if (parsed.length > per4 * 8) {
    issues.push({
      code: "TOO_MANY_CHORDS",
      severity: "warn",
      beat: first.beat,
      message: `${parsed.length} chords in ${bars} bars is too dense.`,
      fix: "Merge chords so that each lasts at least one beat.",
    });
  } else if (parsed.length < per4 * 2) {
    issues.push({
      code: "TOO_FEW_CHORDS",
      severity: "warn",
      beat: first.beat,
      message: `${parsed.length} chords in ${bars} bars is too sparse.`,
      fix: "Add chord changes.",
    });
  }

  // セクション境界の直前にドミナントがあるか
  const sections = resolveSections(plan, bars, beatsPerBar);
  for (const s of sections.slice(1)) {
    const before = [...parsed].reverse().find((p) => p.beat < s.start);
    if (before && before.analysis.fn !== "D") {
      issues.push({
        code: "SECTION_CADENCE",
        severity: "warn",
        beat: s.start,
        message: `Section ${s.name} starts without a dominant before it.`,
        fix: "Put V in the last bar of the previous section.",
      });
    }
  }

  // 説明できない調外和音 (借用・二次ドミナント以外)
  for (const p of parsed) {
    if (!p.analysis.isDiatonic && p.analysis.borrowedFrom === undefined && p.analysis.appliedTo === undefined) {
      issues.push({
        code: "CHROMATIC_UNEXPLAINED",
        severity: "info",
        beat: p.beat,
        message: `${p.symbol} is outside the key and not a recognized borrowing.`,
      });
    }
  }

  // 転調の記録
  for (const kc of plan.keyChanges ?? []) {
    if (kc.bar >= 0 && kc.bar < bars) {
      issues.push({
        code: "MODULATION",
        severity: "info",
        beat: kc.bar * beatsPerBar,
        message: `Modulation to ${kc.key} at bar ${kc.bar + 1}.`,
      });
    }
  }

  // フォームの記録: 役割付きセクションがあるのにサビがない長い曲
  const roles = plan.sections.map((s) => s.role ?? "other");
  if (roles.some((r) => r !== "other") && bars >= 8 && !roles.includes("chorus") && !plan.loop) {
    issues.push({
      code: "FORM",
      severity: "info",
      message: "Long song without a chorus section.",
      fix: "Add a chorus (energy 3) to give the song a focal point.",
    });
  }

  return issues.sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0));
}
