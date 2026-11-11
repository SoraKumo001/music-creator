/**
 * コーパスのリズム分布に基づく comp/bass スタイルの適合度。
 * 「どのスタイルが参照コーパスのオンセット分布に最も近いか」を決定的に測る。
 * 統計のみを使い、旋律や譜面は保持しない。
 */

import type { CorpusProfile } from "../analyze/corpus";
import type { Section } from "../plan";
import { BASS_STYLES, COMP_STYLES, generateBass, generateComp, type Arrangement } from "../theory/accompaniment";

const STEPS = 16;
const BEATS_PER_BAR = 4;
const TOTAL_BEATS = 16;

/** 1小節ずつ I–IV–V–I を置いた評価用の和音列 (スタイルのオンセット分布だけを見る) */
const EVENTS = ["C", "F", "G", "C"].map((symbol, i) => ({ start: i * BEATS_PER_BAR, symbol }));

function sectionFor(comp: string, bass: string): Section[] {
  return [
    {
      name: "A",
      startBar: 0,
      bars: TOTAL_BEATS / BEATS_PER_BAR,
      start: 0,
      end: TOTAL_BEATS,
      comp,
      bass,
      drums: "basic",
      gain: 1,
      role: "other",
      swell: 0,
    },
  ];
}

function onsetHistogram(notes: { start: number }[]): number[] {
  const hist = new Array(STEPS).fill(0);
  let total = 0;
  for (const n of notes) {
    const pos = (((n.start % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) / BEATS_PER_BAR;
    hist[Math.round(pos * STEPS) % STEPS] += 1;
    total++;
  }
  return total === 0 ? hist.map(() => 0) : hist.map((x) => x / total);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export type StyleFit = {
  /** comp スタイル → 最も相性の良い bass と組んだときの類似度 */
  comp: Record<string, number>;
  /** bass スタイル → 最も相性の良い comp と組んだときの類似度 */
  bass: Record<string, number>;
  /** 実際に最良だった組み合わせ */
  bestPair: { comp: string; bass: string; similarity: number };
};

const cache = new Map<string, StyleFit>();

/** プロファイルに対して各スタイルのオンセット分布類似度を求める (結果はキャッシュ) */
export function corpusStyleFit(profile: CorpusProfile): StyleFit {
  const key = `${profile.version}:${profile.rhythm.beatPos16.join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const target = profile.rhythm.beatPos16;
  const comp: Record<string, number> = {};
  const bass: Record<string, number> = {};
  let bestPair: StyleFit["bestPair"] = { comp: COMP_STYLES[0]!, bass: BASS_STYLES[0]!, similarity: -1 };

  for (const c of COMP_STYLES) {
    for (const b of BASS_STYLES) {
      if (b === "none") continue;
      const arrangement: Arrangement = {
        sections: sectionFor(c, b),
        totalBeats: TOTAL_BEATS,
        beatsPerBar: BEATS_PER_BAR,
      };
      let notes: { start: number }[] = [];
      try {
        notes = [...generateComp(EVENTS, arrangement), ...generateBass(EVENTS, arrangement)];
      } catch {
        continue;
      }
      const sim = cosine(onsetHistogram(notes), target);
      comp[c] = Math.max(comp[c] ?? 0, sim);
      bass[b] = Math.max(bass[b] ?? 0, sim);
      if (sim > bestPair.similarity) bestPair = { comp: c, bass: b, similarity: sim };
    }
  }

  const fit: StyleFit = { comp, bass, bestPair };
  cache.set(key, fit);
  return fit;
}

/** 適合度を 0-1 に正規化する (スタイル間の相対比較用) */
export function normalizedStyleScores(scores: Record<string, number>): Record<string, number> {
  const values = Object.values(scores);
  if (values.length === 0) return {};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) out[k] = span === 0 ? 0 : (v - min) / span;
  return out;
}
