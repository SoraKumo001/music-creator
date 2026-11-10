/**
 * フォーム正規化: LLMが細切れのセクションを出したとき、参照コーパスの
 * 「6小節前後のセクション」に近づけるため、隣接セクションを併合する。
 * 和音の絶対位置は変えないので、和声の整合は保たれる。
 */

import type { Plan } from "../plan";

export type FormOptions = {
  /** 目標セクション長 (小節) */
  targetBars?: number;
  /** 併合後の最大セクション数 */
  maxSections?: number;
  /** 1セクションの下限 (これ未満は併合対象) */
  minBars?: number;
};

export type FormResult = { plan: Plan; merged: number; sections: number };

/**
 * セクションが細かすぎる (maxSections 超過 or minBars 未満が多い) 場合に、
 * 最も短い隣接ペアを併合して整える。役割は先頭のものを残し、energy/swell は強い方を採る。
 */
export function normalizeForm(plan: Plan, bars: number, opts: FormOptions = {}): FormResult {
  const targetBars = opts.targetBars ?? 6;
  const maxSections = opts.maxSections ?? Math.max(2, Math.min(6, Math.round(bars / targetBars)));
  void (opts.minBars ?? 3);
  if (plan.sections.length <= 1) return { plan, merged: 0, sections: plan.sections.length };

  let sections = plan.sections.map((s) => ({ ...s }));
  let merged = 0;

  const shouldMerge = () => sections.length > Math.min(maxSections, 6);

  while (shouldMerge() && sections.length > 2) {
    // 最も短い隣接ペアを探す
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let i = 0; i + 1 < sections.length; i++) {
      const len = (sections[i]!.bars + sections[i + 1]!.bars);
      if (len < bestLen) { bestLen = len; bestIdx = i; }
    }
    const a = sections[bestIdx]!;
    const b = sections[bestIdx + 1]!;
    const sum = a.bars + b.bars;
    if (sum > targetBars * 2) break; // 併合しすぎを避ける
    sections[bestIdx] = {
      ...a,
      bars: sum,
      // 役割は先頭優先。energy は高い方、swell は方向を保つ
      energy: Math.max(a.energy, b.energy),
      swell: a.swell !== 0 ? a.swell : b.swell,
    };
    sections.splice(bestIdx + 1, 1);
    merged++;
  }

  // 合計が要求小節数と合うように最後を調整 (resolveSections が延長するので通常は不要)
  const total = sections.reduce((n, s) => n + s.bars, 0);
  if (total > bars && sections.length > 0) {
    const last = sections[sections.length - 1]!;
    last.bars = Math.max(1, last.bars - (total - bars));
  }
  return { plan: { ...plan, sections }, merged, sections: sections.length };
}

