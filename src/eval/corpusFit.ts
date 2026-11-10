/**
 * コーパス適合度: 生成した曲が解析プロファイルの傾向にどれだけ寄っているかを測る。
 * 「解析 → 生成 → 測定 → 改善」のループを回すための指標。
 */

import type { CorpusProfile } from "../analyze/corpus";
import { keyAtBeat, type Plan } from "../plan";
import type { Score } from "../score";
import { programFamily } from "../analyze/features";
import { parseKeyName } from "../theory/key";
import { analyzeChord } from "../theory/roman";

export type CorpusFitOptions = {
  /** 生成時の complexity (rich ほど逸脱を許す) */
  complexity?: "simple" | "standard" | "rich";
  /** 文脈に応じた重み。省略時は全項目等重み */
  weights?: Partial<Record<keyof CorpusFitParts, number>>;
};

export type CorpusFitParts = {
  tempo: number;
  mode: number;
  meter: number;
  instruments: number;
  rhythm: number;
  drums: number;
  harmonicRhythm: number;
  chordQualities: number;
  borrowed: number;
  form: number;
};

export type CorpusFitResult = {
  total: number;
  parts: CorpusFitParts;
  notes: string[];
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** 目標値との差を許容幅つきで評価する (測定誤差が大きい指標向け) */
function toleranceFit(actual: number, target: number, tol: number, falloff: number): number {
  const diff = Math.abs(actual - target);
  if (diff <= tol) return 1;
  return clamp01(1 - (diff - tol) / Math.max(1e-6, falloff - tol));
}

function tempoFit(bpm: number, p: CorpusProfile): number {
  if (bpm <= p.tempo.p10) return clamp01(1 - (p.tempo.p10 - bpm) / 30);
  if (bpm >= p.tempo.p90) return clamp01(1 - (bpm - p.tempo.p90) / 30);
  return 1;
}

function modeFit(key: string, p: CorpusProfile): number {
  const mode = parseKeyName(key).mode;
  return mode === "minor" ? p.modeShare.minor : p.modeShare.major;
}

function meterFit(plan: Plan, p: CorpusProfile): number {
  const meter = `${plan.timeSignature[0]}/${plan.timeSignature[1]}`;
  return p.meters[meter] ?? 0.05;
}

/** 生成された音色構成とコーパスの楽器分布のコサイン類似 */
function instrumentFit(score: Score, p: CorpusProfile): number {
  const counts = new Map<string, number>();
  for (const t of score.tracks) {
    if (t.channel === 9) continue;
    const fam = programFamily(t.program);
    counts.set(fam, (counts.get(fam) ?? 0) + t.notes.length);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [fam, count] of counts) {
    const a = count / total;
    const b = p.instruments[fam] ?? 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  return na === 0 || nb === 0 ? 0 : clamp01(dot / Math.sqrt(na * nb));
}

/** 16分グリッドのオンセット分布の類似 */
function rhythmFit(score: Score, plan: Plan, p: CorpusProfile): number {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const steps = Math.max(4, Math.round(beatsPerBar * 4));
  const hist = new Array(steps).fill(0);
  let total = 0;
  for (const t of score.tracks) {
    if (t.channel === 9) continue;
    for (const n of t.notes) {
      const posInBar = ((n.start % beatsPerBar) + beatsPerBar) % beatsPerBar / beatsPerBar;
      const bin = Math.round(posInBar * steps) % steps;
      hist[bin] += 1;
      total++;
    }
  }
  if (total === 0) return 0;
  const target = p.rhythm.beatPos16;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.max(steps, target.length); i++) {
    const a = (hist[i] ?? 0) / total;
    const b = target[i] ?? 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  return na === 0 || nb === 0 ? 0 : clamp01(dot / Math.sqrt(na * nb));
}

function drumFit(score: Score, p: CorpusProfile): number {
  const counts = new Map<string, number>();
  for (const t of score.tracks) {
    if (t.channel !== 9) continue;
    for (const n of t.notes) counts.set(String(n.pitch), (counts.get(String(n.pitch)) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [pitch, count] of counts) {
    const a = count / total;
    const b = p.drums[pitch] ?? 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  return na === 0 || nb === 0 ? 0 : clamp01(dot / Math.sqrt(na * nb));
}

/** 生成プランの和声をコーパスと比較 (和声リズム・品質・借用率) */
function harmonyFits(plan: Plan, p: CorpusProfile, mode: "simple" | "standard" | "rich") {
  const notes: string[] = [];
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const chords = [...plan.chords].sort((a, b) => a[0] - b[0]);
  const bars = Math.max(1, Math.ceil((chords.at(-1)?.[0] ?? beatsPerBar) / beatsPerBar) + 1);
  const chordsPerBar = chords.length / bars;
  const target = p.harmony.medianChordsPerBar;
  const harmonicRhythm = clamp01(1 - Math.abs(chordsPerBar - target) / Math.max(0.75, target));

  const qualityCounts = new Map<string, number>();
  let borrowed = 0;
  let borrowedCandidates = 0;
  for (const [beat, symbol] of chords) {
    try {
      const a = analyzeChord(symbol, parseKeyName(keyAtBeat(plan, beat, beatsPerBar)));
      // コーパス側と同じ基準: sus / パワーコードは借用率から除外
      if (!/sus|^[A-G][#b]?5$/.test(symbol)) {
        borrowedCandidates++;
        if (!a.isDiatonic && (a.borrowedFrom !== undefined || a.appliedTo !== undefined)) borrowed++;
      }
      const suffix = symbol.replace(/^[A-G][#b]?/, "");
      qualityCounts.set(suffix, (qualityCounts.get(suffix) ?? 0) + 1);
    } catch { /* noop */ }
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  const total = [...qualityCounts.values()].reduce((a, b) => a + b, 0);
  for (const [q, c] of qualityCounts) {
    const a = c / Math.max(1, total);
    const b = p.harmony.qualities[q] ?? 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  const chordQualities = na === 0 || nb === 0 ? 0 : clamp01(dot / Math.sqrt(na * nb));

  const borrowedRate = borrowedCandidates === 0 ? 0 : borrowed / borrowedCandidates;
  // 借用率はコード推定の不確かさが大きいので、±0.12 の許容幅を持たせる
  const borrowedFit = toleranceFit(borrowedRate, p.harmony.borrowedRate, 0.12, 0.4);

  const sectionBars = plan.sections.map((s) => s.bars).filter((b) => b >= 2);
  const targetSection = p.form.medianSectionBars;
  const form = sectionBars.length === 0
    ? 0.5
    : sectionBars.reduce((acc, b) => acc + clamp01(1 - Math.abs(b - targetSection) / Math.max(4, targetSection)), 0) / sectionBars.length;

  if (mode === "rich") {
    // rich は意図的な逸脱なので減点しない (最低点を引き上げる)
    return {
      harmonicRhythm: Math.max(0.7, harmonicRhythm),
      chordQualities: Math.max(0.6, chordQualities),
      borrowed: Math.max(0.6, borrowedFit),
      form: Math.max(0.5, form),
      notes,
    };
  }
  if (chordsPerBar > target * 2.5) notes.push(`harmonic rhythm is much denser than the corpus (${round(chordsPerBar, 2)} vs ${target}/bar)`);
  if (borrowedRate < p.harmony.borrowedRate * 0.3) notes.push(`almost no borrowed/secondary chords (corpus uses about ${Math.round(p.harmony.borrowedRate * 100)}%)`);
  return { harmonicRhythm, chordQualities, borrowed: borrowedFit, form, notes };
}

export function evaluateCorpusFit(plan: Plan, score: Score, profile: CorpusProfile, opts: CorpusFitOptions = {}): CorpusFitResult {
  const mode = opts.complexity ?? "standard";
  const harmony = harmonyFits(plan, profile, mode);
  // コーパスのテンポが全曲同一 (= 書き出し規約) の場合はテンポを評価対象から外す
  const tempoIsInformative = profile.tempo.p90 - profile.tempo.p10 >= 5;
  const parts: CorpusFitParts = {
    tempo: tempoIsInformative ? tempoFit(plan.bpm, profile) : 1,
    mode: modeFit(plan.key, profile),
    meter: meterFit(plan, profile),
    instruments: instrumentFit(score, profile),
    rhythm: rhythmFit(score, plan, profile),
    drums: drumFit(score, profile),
    harmonicRhythm: harmony.harmonicRhythm,
    chordQualities: harmony.chordQualities,
    borrowed: harmony.borrowed,
    form: harmony.form,
  };
  const weights: Record<keyof CorpusFitParts, number> = {
    tempo: tempoIsInformative ? 12 : 0, mode: 8, meter: 6, instruments: 12, rhythm: 14, drums: 10,
    harmonicRhythm: 12, chordQualities: 10, borrowed: 6, form: 8,
    ...opts.weights,
  };
  let sum = 0;
  let wsum = 0;
  for (const k of Object.keys(parts) as (keyof CorpusFitParts)[]) {
    sum += parts[k] * weights[k];
    wsum += weights[k];
  }
  const notes = [...harmony.notes];
  if (tempoIsInformative && parts.tempo < 0.5) {
    notes.push(`tempo ${plan.bpm} BPM is outside the corpus band (${profile.tempo.p10}-${profile.tempo.p90})`);
  }
  if (parts.instruments < 0.5) notes.push("instrument mix differs from the corpus (check program choices)");
  if (parts.drums < 0.5) notes.push("drum emphasis differs from the corpus (check which drum sounds dominate)");
  return { total: round((sum / Math.max(1, wsum)) * 100, 1), parts, notes };
}
