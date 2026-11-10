/**
 * Web 知識カードから導いた「作曲クラフト」の決定的チェック。
 *
 * 知識カードの自由文をそのまま使うのではなく、カードが述べている原則を
 * コード上の決定的な条件へ落とし込んだもの。用途:
 * - プラン生成時のルール層: 違反が2項目以上なら1回だけ作り直させる
 * - 評価: 生成物がクラフト原則をどれだけ満たすかを 0-100 で測る
 */

import { keyAtBeat, type Plan, type Section } from "../plan";
import { parseKeyName } from "./key";
import { analyzeChord, type Analysis } from "./roman";

export type CraftCheckId =
  | "tonicEarly"
  | "cadenceBeforeLastSection"
  | "tonicClosure"
  | "sectionContrast"
  | "thematicReturn"
  | "harmonicRhythm";

export type CraftCheck = {
  id: CraftCheckId;
  label: string;
  ok: boolean;
  detail: string;
  /** このチェックの根拠にした知識カードの分類 */
  ruleSource: string;
};

export type CraftReport = {
  /** 満たした割合 (0-100) */
  score: number;
  checks: CraftCheck[];
  failed: CraftCheckId[];
};

type AnalyzedChord = { beat: number; symbol: string; a: Analysis | null };

/** プランとセクションからクラフトチェックを評価する (決定的・副作用なし) */
export function evaluateCraft(plan: Plan, sections: Section[], bars: number): CraftReport {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const chords: AnalyzedChord[] = [...plan.chords]
    .sort((x, y) => x[0] - y[0])
    .map(([beat, symbol]) => {
      try {
        return { beat, symbol, a: analyzeChord(symbol, parseKeyName(keyAtBeat(plan, beat, beatsPerBar))) };
      } catch {
        return { beat, symbol, a: null };
      }
    });
  const isTonic = (c: AnalyzedChord) => c.a !== null && c.a.degree === 1 && c.a.accidental === 0;
  const isDominant = (c: AnalyzedChord) => c.a !== null && c.a.fn === "D";
  const last = chords[chords.length - 1];
  const checks: CraftCheck[] = [];

  // 1. トニックを早く提示する (カード: keep the tonic audible / state I early)
  const early = chords.find((c) => c.beat < 2 * beatsPerBar - 1e-6 && isTonic(c));
  checks.push({
    id: "tonicEarly",
    label: "state the tonic within the first two bars",
    ok: early !== undefined,
    detail: early ? `tonic ${early.symbol} at beat ${early.beat}` : "no tonic chord in the first two bars",
    ruleSource: "web:harmony",
  });

  // 2. 最後のセクションの直前をカデンツで締める (カード: end phrases with a cadence)
  const lastStart = sections.length >= 2 ? sections[sections.length - 1]!.start : Infinity;
  const beforeBoundary = [...chords].reverse().find((c) => c.beat < lastStart - 1e-6);
  const cadenceOk =
    sections.length < 2 ||
    (beforeBoundary !== undefined &&
      (isDominant(beforeBoundary) || isTonic(beforeBoundary) || (beforeBoundary.a?.degree === 4 && beforeBoundary.a.accidental === 0)));
  checks.push({
    id: "cadenceBeforeLastSection",
    label: "close the phrase before the final section with a cadence",
    ok: cadenceOk,
    detail:
      sections.length < 2
        ? "single section: not applicable"
        : beforeBoundary
          ? `chord before the final section is ${beforeBoundary.symbol} (${beforeBoundary.a?.numeral ?? "?"})`
          : "no chord before the final section",
    ruleSource: "web:form",
  });

  // 3. 最後をトニック (ループは導音/トニック) で閉じる (カード: strong tonal closure)
  const closureOk =
    last !== undefined && (plan.loop ? isTonic(last) || isDominant(last) : isTonic(last));
  checks.push({
    id: "tonicClosure",
    label: "end on the tonic (or, for loops, on the dominant)",
    ok: closureOk,
    detail: last ? `final chord is ${last.symbol}` : "no chords",
    ruleSource: "web:harmony",
  });

  // 4. セクションごとに表情を変える (カード: verse/chorus contrast in arrangement)
  const styles = new Set(sections.map((s) => `${s.comp}|${s.bass}|${s.drums}|${s.gain}`));
  const contrastOk = sections.length < 2 || styles.size >= 2;
  checks.push({
    id: "sectionContrast",
    label: "vary the arrangement between sections",
    ok: contrastOk,
    detail:
      sections.length < 2
        ? "single section: not applicable"
        : `${styles.size} distinct style combination(s) across ${sections.length} sections`,
    ruleSource: "web:arrangement",
  });

  // 5. 16小節以上なら verse/chorus を再登場させる (カード: bring the main theme back)
  let thematicOk = true;
  let thematicDetail = "shorter than 16 bars: not applicable";
  if (bars >= 16) {
    const counts = new Map<string, number>();
    for (const s of sections) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
    const recurring = ["verse", "chorus"].filter((role) => counts.has(role));
    thematicOk = recurring.length === 0 || recurring.some((role) => (counts.get(role) ?? 0) >= 2);
    thematicDetail =
      recurring.length === 0
        ? "no verse/chorus roles declared"
        : recurring.map((role) => `${role}×${counts.get(role)}`).join(", ");
  }
  checks.push({
    id: "thematicReturn",
    label: "bring verse/chorus back at least twice in longer songs",
    ok: thematicOk,
    detail: thematicDetail,
    ruleSource: "web:form",
  });

  // 6. 和声リズムを粗くしすぎない/詰め込みすぎない (カード: keep progressions short, about 1-2 chords per bar)
  const chordsPerBar = chords.length / Math.max(1, bars);
  const rhythmOk = chordsPerBar >= 0.5 && chordsPerBar <= 2.5;
  checks.push({
    id: "harmonicRhythm",
    label: "keep about one or two chord changes per bar",
    ok: rhythmOk,
    detail: `${Math.round(chordsPerBar * 100) / 100} chords/bar`,
    ruleSource: "web:harmony",
  });

  const okCount = checks.filter((c) => c.ok).length;
  return {
    score: Math.round((okCount / Math.max(1, checks.length)) * 100),
    checks,
    failed: checks.filter((c) => !c.ok).map((c) => c.id),
  };
}
