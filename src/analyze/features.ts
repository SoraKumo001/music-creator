/**
 * MIDI 1曲から音楽的特徴を抽出する (依存なし・決定的)。
 * 生成パイプラインの改善に使う「統計」だけを作り、旋律そのものは保存しない。
 */

import type { ParsedMidi, ParsedNote } from "../midi/parseMidi";
import { parseKeyName } from "../theory/key";
import { analyzeChord } from "../theory/roman";

export const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Krumhansl-Kessler の調性プロファイル (長調 / 短調) */
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type ChordGuess = { beat: number; bar: number; symbol: string; numeral: string; fn: string; confidence: number };

export type MidiFeatures = {
  name: string;
  /** 秒 */
  durationSec: number;
  bpm: number;
  bpmMin: number;
  bpmMax: number;
  timeSignature: [number, number];
  bars: number;
  /** 推定した小節長 (ticks) */
  barTicks: number;
  /** declared = 宣言値、inferred = 実測から推定 */
  barInference: "declared" | "inferred";
  barConfidence: number;
  /** 小節内の分割数 (通常16) */
  stepsPerBar: number;
  key: string;
  keyConfidence: number;
  tracks: number;
  channels: number;
  noteCount: number;
  /** 秒あたりノート数 */
  density: number;
  polyphonyMean: number;
  /** GM音色番号の出現頻度 */
  programs: Record<string, number>;
  /** ドラムのGM番号出現数 */
  drumHits: Record<string, number>;
  /** 拍内12分割 (1/12拍 = 8分3連と16分を両方表現できる) のオンセット分布 (合計1) */
  beatPos12: number[];
  /** 音価 (16分単位) の分布 (合計1) */
  durations16: number[];
  /** 拍頭 (bin 0) の割合 */
  downbeatShare: number;
  /** 裏8分 (bin 6) の割合 */
  offbeat8thShare: number;
  /** 16分 (bin 3, 9) の割合 */
  sixteenthShare: number;
  /** 3連 (bin 4, 8) の割合 */
  offGridShare: number;
  /** 検出した打ち込み量子化単位 (拍) */
  quantizationUnitBeats: number;
  /** コード1小節あたりの平均数 */
  chordsPerBar: number;
  /** 推定コードの品質分布 */
  chordQualities: Record<string, number>;
  /** ローマ数字のビッグラム (上位) */
  romanBigrams: Record<string, number>;
  /** 借用・二次ドミナント率 */
  borrowedRate: number;
  /** 平均セクション長 (小節)。構成検出できない場合は全体 */
  sectionBars: number[];
  /**
   * セクションごとのドラム構成と密度 (energy 別の統計に使う)。
   * density は非ドラムのオンセット数 / 小節。
   */
  sectionStats: {
    bars: number;
    density: number;
    drumTotal: number;
    /** ドラムGM番号の出現割合 (合計1。ドラムが無ければ空) */
    drumShares: Record<string, number>;
  }[];
  /** 最高声部の音程ヒストグラム (半音, 絶対値) */
  intervalHistogram: number[];
  /** 旋律の音域 (半音) */
  melodyRange: number;
  /** 旋律の 1 小節あたり平均音符数 */
  melodyNotesPerBar: number;
  /** 旋律の開始位置が拍頭からずれている割合 */
  offbeatRatio: number;
  /** ベース声部の統計 (GM 32-39。無ければ低音域) */
  bass: {
    notesPerBar: number;
    medianPitch: number;
    /** 連続するベース音の音程ヒストグラム (半音, mod 12, 合計1) */
    motionHistogram: number[];
    /** 完全4度/5度 (5,7半音) の割合 */
    fifthShare: number;
    /** 順次進行 (1,2半音) の割合 */
    stepShare: number;
    /** 跳躍 (8半音以上) の割合 */
    leapShare: number;
  };
  /** 旋律 (トップライン) の質感 */
  melody: {
    medianPitch: number;
    /** 順次進行 (1,2半音) の割合 */
    stepwiseShare: number;
    /** フレーズの切れ目 (0.5拍以上のギャップ) の割合 */
    restRatio: number;
    /** 音価の中央値 (16分単位) */
    medianDuration16: number;
  };
  /** sus4/sus2 の割合 (コード枠に占める) */
  susShare: number;
  /** 7th 系 (maj7/min7/7/dim7等) の割合 */
  seventhShare: number;
  /** 楽器ファミリー別の出現数・密度・音域 */
  familyStats: Record<string, { notes: number; notesPerBar: number; medianPitch: number }>;
  /**
   * ドラムのフィル統計。トム/スネアが集中する小節をフィルとみなす。
   * phraseEnd は 4小節区切りの最終小節。
   */
  drumFills: {
    barsWithDrums: number;
    fillBars: number;
    phraseEndBars: number;
    phraseEndFills: number;
  };
};

const round = (x: number, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * 実データから小節長 (ticks) を推定する。
 * この種のMIDIは division / テンポの宣言と実際の拍節が一致しないことがあるため、
 * オンセットの自己相関で「周期的に強く繰り返す長さ」を探し、宣言値の近傍で最も強いものを採る。
 */
export function inferBarTicks(
  ticks: number[],
  division: number,
  declaredBeatsPerBar: number,
  opts: { minImprovement?: number } = {},
): { barTicks: number; confidence: number; source: "declared" | "inferred" } {
  /** 推定値を採用するのに必要な自己相関の改善率 (大きいほど宣言値を優先) */
  const minImprovement = opts.minImprovement ?? 0.08;
  const declared = Math.max(8, declaredBeatsPerBar * division);
  if (ticks.length < 16) return { barTicks: declared, confidence: 0, source: "declared" };
  const start = Math.min(...ticks);
  const rel = ticks.map((t) => t - start);
  const maxLag = Math.min(1280, Math.max(480, Math.round(declared * 2.2)));

  // 1 tick 解像度のヒストグラムで自己相関 (ラグ = 周期的に繰り返す長さ)
  const hist = new Float64Array(maxLag);
  for (const t of rel) {
    const idx = ((t % maxLag) + maxLag) % maxLag;
    hist[idx] = (hist[idx] ?? 0) + 1;
  }
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 8; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < maxLag; i++) s += hist[i]! * hist[(i + lag) % maxLag]!;
    ac[lag] = s;
  }

  // 宣言値 0.6〜1.6 倍の範囲で、自己相関が局所最大になる長さを探す
  let best = { lag: declared, score: -Infinity };
  const lo = Math.round(declared * 0.6);
  const hi = Math.round(declared * 1.6);
  for (let lag = lo; lag <= hi; lag++) {
    if (ac[lag]! <= 0) continue;
    const isLocalMax = ac[lag]! >= ac[lag - 1]! && ac[lag]! >= ac[lag + 1]!;
    if (!isLocalMax) continue;
    // 宣言値への近さで軽く重み付け (極端な長さを避ける)
    const near = 1 - Math.min(1, Math.abs(Math.log(lag / declared)) * 0.5);
    const score = (ac[lag]! / Math.max(1e-9, ac[Math.max(8, Math.round(declared))]!)) * near;
    if (score > best.score) best = { lag, score };
  }
  const declaredScore = ac[Math.max(8, Math.round(declared))]!;
  const improvement = best.score - 1;
  // 明確な改善があるときだけ推定値を使う
  if (best.lag !== Math.round(declared) && improvement > minImprovement) {
    return { barTicks: best.lag, confidence: round(Math.min(1, improvement), 3), source: "inferred" };
  }
  void declaredScore;
  return { barTicks: Math.round(declared), confidence: 0, source: "declared" };
}

/** すべてのトラックのノートをマージ */
function allNotes(midi: ParsedMidi): ParsedNote[] {
  return midi.tracks.flatMap((t) => t.notes).sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

function normalizeHistogram(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  return sum === 0 ? values.map(() => 0) : values.map((v) => round(v / sum, 4));
}

/** 打ち込みの量子化単位 (ticks) を検出する。この種のMIDIは 1/96 音符単位で打たれていることが多い */
function detectUnitTicks(ticks: number[]): number {
  let best = { unit: 0, score: -1 };
  for (let u = 2; u <= 60; u++) {
    let score = 0;
    for (const t of ticks) {
      const r = ((t % u) + u) % u;
      const d = Math.min(r, u - r) / u;
      score += Math.max(0, 1 - d / 0.25);
    }
    if (score > best.score) best = { unit: u, score };
  }
  return best.unit > 0 ? best.unit : 1;
}

/** 音の長さで重み付けしたピッチクラス分布 */
function pitchClassWeights(notes: ParsedNote[], division: number): number[] {
  const w = new Array(12).fill(0);
  for (const n of notes) {
    const beats = n.durationTicks / division;
    w[n.pitch % 12] += Math.max(0.05, Math.min(4, beats));
  }
  return w;
}

function correlate(a: number[], b: number[]): number {
  const mean = (xs: number[]) => xs.reduce((p, c) => p + c, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export function estimateKey(notes: ParsedNote[], division: number): { key: string; confidence: number } {
  const weights = pitchClassWeights(notes, division);
  let best = { key: "C major", confidence: -2 };
  for (let root = 0; root < 12; root++) {
    for (const mode of ["major", "minor"] as const) {
      const profile = mode === "major" ? KK_MAJOR : KK_MINOR;
      const rotated = Array.from({ length: 12 }, (_, i) => profile[(i - root + 12) % 12]!);
      const score = correlate(weights, rotated);
      if (score > best.confidence) best = { key: `${PC_NAMES[root]} ${mode}`, confidence: round(score, 3) };
    }
  }
  return best;
}

/** 拍位置のコード推定 (和音テンプレートとの一致度) */
const CHORD_TEMPLATES: { suffix: string; intervals: number[] }[] = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "dim7", intervals: [0, 3, 6, 9] },
  { suffix: "m7b5", intervals: [0, 3, 6, 10] },
  { suffix: "aug", intervals: [0, 4, 8] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  // パワーコード (3度なし)。ロック系はこれが正解なので優先的に評価する
  { suffix: "5", intervals: [0, 7] },
];

function guessChordAt(notes: ParsedNote[], fromTick: number, toTick: number): { symbol: string; confidence: number } | null {
  const inWindow = notes.filter((n) => n.tick < toTick && n.tick + n.durationTicks > fromTick);
  if (inWindow.length === 0) return null;
  const weights = new Array(12).fill(0);
  let bassPc = -1;
  let lowest = Infinity;
  for (const n of inWindow) {
    const overlap = Math.min(n.tick + n.durationTicks, toTick) - Math.max(n.tick, fromTick);
    if (overlap <= 0) continue;
    weights[n.pitch % 12] += overlap;
    if (n.pitch < lowest) { lowest = n.pitch; bassPc = n.pitch % 12; }
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || bassPc < 0) return null;

  let best: { symbol: string; confidence: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const tpl of CHORD_TEMPLATES) {
      const pcs = tpl.intervals.map((i) => (root + i) % 12);
      let inside = 0;
      for (const pc of pcs) inside += weights[pc]!;
      let outside = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (!pcs.includes(pc)) outside += weights[pc]!;
      }
      const coverage = inside / total;
      const purity = inside / (inside + outside * 0.6);
      // 構成音が実際に鳴っているか (テンプレートの音が欠けている場合は減点)
      const present = pcs.filter((pc) => weights[pc]! / total >= 0.06).length;
      const completeness = present / pcs.length;
      // ベース音がルートなら加点
      const rootBonus = bassPc === root ? 0.12 : 0;
      const confidence = coverage * 0.4 + purity * 0.3 + completeness * 0.18 + rootBonus;
      if (!best || confidence > best.confidence) {
        best = { symbol: PC_NAMES[root]! + tpl.suffix, confidence: round(confidence, 3) };
      }
    }
  }
  return best;
}

/** 小節ごとのコード列 → ローマ数字・品質・借用率。startTick は曲の実開始位置 */
function analyzeHarmony(notes: ParsedNote[], midi: ParsedMidi, barTicks: number, key: string, startTick: number) {
  const bars = Math.max(1, Math.ceil((midi.durationTicks - startTick) / barTicks));
  const keyCtx = parseKeyName(key);
  const chords: ChordGuess[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = startTick + bar * barTicks;
    const to = from + barTicks;
    const guess = guessChordAt(notes, from, to);
    if (!guess) continue;
    try {
      const a = analyzeChord(guess.symbol, keyCtx);
      chords.push({
        beat: bar, bar, symbol: guess.symbol,
        numeral: a.numeral, fn: a.fn, confidence: guess.confidence,
      });
    } catch { /* 解析不能は捨てる */ }
  }
  const qualities: Record<string, number> = {};
  const bigrams: Record<string, number> = {};
  let borrowed = 0;
  let borrowedCandidates = 0;
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i]!;
    const quality = c.symbol.slice(c.symbol.search(/[^A-G#b]/) >= 0 ? c.symbol.search(/[^A-G#b]/) : c.symbol.length) || "maj";
    qualities[quality] = (qualities[quality] ?? 0) + 1;
    try {
      const a = analyzeChord(c.symbol, keyCtx);
      // sus / パワーコードは「品質の置換」であって借用ではないため借用率から除く
      const isSuspension = /sus|^[A-G][#b]?5$/.test(c.symbol);
      if (!isSuspension) {
        borrowedCandidates++;
        if (!a.isDiatonic && (a.borrowedFrom !== undefined || a.appliedTo !== undefined)) borrowed++;
      }
    } catch { /* noop */ }
    const next = chords[i + 1];
    if (next) {
      const bg = `${c.numeral}>${next.numeral}`;
      bigrams[bg] = (bigrams[bg] ?? 0) + 1;
    }
  }
  return {
    bars,
    chords,
    chordsPerBar: round(chords.length / bars, 2),
    qualities,
    bigrams,
    borrowedRate: borrowedCandidates === 0 ? 0 : round(borrowed / borrowedCandidates, 3),
  };
}

/** 最高声部を単旋律として抜き出す */
function extractTopLine(notes: ParsedNote[], barTicks: number, bars: number, startTick: number): ParsedNote[] {
  const grid = barTicks / 16; // 16分音符相当
  const slots = Math.max(1, Math.ceil((bars * barTicks) / grid));
  const best: (ParsedNote | null)[] = new Array(slots).fill(null);
  for (const n of notes) {
    const startSlot = Math.floor((n.tick - startTick) / grid);
    if (startSlot < 0) continue;
    const endSlot = Math.min(slots, Math.max(startSlot + 1, Math.ceil((n.tick - startTick + n.durationTicks) / grid)));
    for (let s = startSlot; s < endSlot; s++) {
      const cur = best[s];
      if (cur === null || cur === undefined || n.pitch > cur.pitch) best[s] = n;
    }
  }
  // 同一ノートの連続は 1 つにまとめる
  const out: ParsedNote[] = [];
  let prev: ParsedNote | null = null;
  for (const n of best) {
    if (!n) { prev = null; continue; }
    if (prev && prev.tick === n.tick && prev.pitch === n.pitch) continue;
    out.push(n);
    prev = n;
  }
  return out;
}

/** 小節単位の類似度からセクション境界を推定する */
function detectSections(notes: ParsedNote[], barTicks: number, bars: number, startTick: number): number[] {
  if (bars < 4) return [bars];
  const barChroma: number[][] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = startTick + bar * barTicks;
    const to = from + barTicks;
    const v = new Array(12).fill(0);
    for (const n of notes) {
      if (n.tick < from || n.tick >= to) continue;
      v[n.pitch % 12] += 1;
    }
    const sum = v.reduce((a, b) => a + b, 0) || 1;
    barChroma.push(v.map((x) => x / sum));
  }
  const dist = (a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < 12; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return na === 0 || nb === 0 ? 0 : 1 - dot / Math.sqrt(na * nb);
  };
  const lengths: number[] = [];
  let start = 0;
  for (let bar = 1; bar < bars; bar++) {
    // 直近2小節と次の2小節の平均クロマが大きく変わる地点を境界とみなす
    const win = 2;
    if (bar + win > bars) break;
    const before = [barChroma[bar - 1]!, barChroma[bar - 2] ?? barChroma[bar - 1]!];
    const after = [barChroma[bar]!, barChroma[bar + 1]!];
    const avg = (xs: number[][]) => xs.reduce((acc, v) => acc.map((x, i) => x + v[i]!), new Array(12).fill(0)).map((x) => x / xs.length);
    if (dist(avg(before), avg(after)) > 0.22) {
      lengths.push(bar - start);
      start = bar;
    }
  }
  lengths.push(bars - start);
  // 短すぎる断片は前のセクションへ併合する (ノイズ除去)
  const merged: number[] = [];
  for (const len of lengths.filter((x) => x > 0)) {
    if (len < 2 && merged.length > 0) merged[merged.length - 1] = merged[merged.length - 1]! + len;
    else merged.push(len);
  }
  return merged;
}

/** テンポ: 最長区間を代表値にし、範囲は有意な区間 (全体の2%以上) から取る */
function tempoStats(midi: ParsedMidi): { bpm: number; bpmMin: number; bpmMax: number } {
  const segs: { bpm: number; span: number }[] = [];
  const tempos = midi.tempos;
  for (let i = 0; i < tempos.length; i++) {
    const start = tempos[i]!.tick;
    const end = i + 1 < tempos.length ? tempos[i + 1]!.tick : midi.durationTicks;
    const span = Math.max(0, end - start);
    if (span > 0) segs.push({ bpm: tempos[i]!.bpm, span });
  }
  if (segs.length === 0) return { bpm: 120, bpmMin: 120, bpmMax: 120 };
  const total = segs.reduce((a, s) => a + s.span, 0) || 1;
  // 極端なテンポ (この種のMIDIには演出用の 800BPM 等が混ざる) は範囲から除外
  const significant = segs.filter((s) => s.span / total >= 0.02 && s.bpm >= 30 && s.bpm <= 300);
  const dominant = [...segs].filter((s) => s.bpm >= 30 && s.bpm <= 300).sort((a, b) => b.span - a.span)[0]?.bpm ?? 120;
  const bpmValues = significant.length > 0 ? significant.map((s) => s.bpm) : [dominant];
  return {
    bpm: round(dominant, 1),
    bpmMin: round(Math.min(...bpmValues), 1),
    bpmMax: round(Math.max(...bpmValues), 1),
  };
}

export type FeatureOptions = {
  /**
   * 旋律として扱う MIDI チャンネル。指定すると旋律系の指標をそのチャンネルだけで計算する。
   * 未指定なら最高声部 (全チャンネル) を旋律とみなす (コーパスはパート情報が無いため)。
   */
  melodyChannel?: number;
  /** 拍節推定で宣言値を優先する強さ (0-1)。大きいほど宣言値を採用しやすい */
  barInferenceThreshold?: number;
};

export function extractFeatures(name: string, midi: ParsedMidi, opts: FeatureOptions = {}): MidiFeatures {
  const division = midi.division;
  const notes = allNotes(midi);
  const ts = mostCommonTimeSignature(midi);
  const beatsPerBar = (ts[0] * 4) / ts[1];
  // 曲の実開始位置 (先頭に無音やセットアップがあるMIDIへの対策)
  const startTick = notes.length > 0 ? Math.min(...notes.map((n) => n.tick)) : 0;
  const musicEndTick = notes.length > 0 ? Math.max(...notes.map((n) => n.tick + n.durationTicks)) : midi.durationTicks;

  const { bpm, bpmMin, bpmMax } = tempoStats(midi);
  const durationSec = round(midi.durationSeconds, 2);
  const density = round(notes.length / Math.max(0.5, durationSec), 3);

  // ポリフォニー平均 (同時発音の平均)
  const onsetsByTick = new Map<number, number>();
  for (const n of notes) onsetsByTick.set(n.tick, (onsetsByTick.get(n.tick) ?? 0) + 1);
  const polyphonyMean = round(
    [...onsetsByTick.values()].reduce((a, b) => a + b, 0) / Math.max(1, onsetsByTick.size),
    2,
  );

  // 拍節は実測から推定する (宣言 division と食い違うMIDIへの対策)
  const barInference = inferBarTicks(notes.map((n) => n.tick), division, beatsPerBar, {
    minImprovement: opts.barInferenceThreshold,
  });
  const barTicks = barInference.barTicks;
  const beatTicks = barTicks / beatsPerBar;
  const bars = Math.max(1, Math.ceil((musicEndTick - startTick) / barTicks));
  const stepsPerBar = Math.max(4, Math.round(beatsPerBar * 4)); // 16分分解能 (4/4 なら 16)

  // 音色・ドラム
  const programs: Record<string, number> = {};
  const drumHits: Record<string, number> = {};
  for (const n of notes) {
    if (n.channel === 9) drumHits[String(n.pitch)] = (drumHits[String(n.pitch)] ?? 0) + 1;
    else programs[String(n.program)] = (programs[String(n.program)] ?? 0) + 1;
  }

  // 小節内 16分ステップのオンセット分布 (非ドラム)
  const beatPos = new Array(stepsPerBar).fill(0);
  const durations = new Array(16).fill(0);
  let downbeat = 0;
  let offbeat8th = 0;
  let sixteenth = 0;
  let triplet = 0;
  let rhythmTotal = 0;
  const unit = detectUnitTicks(notes.filter((n) => n.channel !== 9).map((n) => n.tick));
  for (const n of notes) {
    if (n.channel === 9) continue;
    rhythmTotal++;
    const posInBar = (((n.tick - startTick) / barTicks) % 1 + 1) % 1;
    const bin = Math.round(posInBar * stepsPerBar) % stepsPerBar;
    beatPos[bin] += 1;
    if (bin % 4 === 0) downbeat++;
    else if (bin % 2 === 0) offbeat8th++;
    else sixteenth++;
    // 3連は 16分ステップに乗らない位置 (bin 端数) で近似判定
    const exact = posInBar * stepsPerBar;
    if (Math.abs(exact - Math.round(exact)) > 0.3) triplet++;
    const durBeats = n.durationTicks / beatTicks;
    const dur16 = Math.round(durBeats * 4);
    durations[Math.min(15, Math.max(1, dur16) - 1)] += 1;
  }

  const key = estimateKey(notes.filter((n) => n.channel !== 9), division);
  const harmony = analyzeHarmony(notes.filter((n) => n.channel !== 9), midi, barTicks, key.key, startTick);

  // 旋律 (最高声部)
  const melodySource = opts.melodyChannel === undefined
    ? notes.filter((n) => n.channel !== 9)
    : notes.filter((n) => n.channel === opts.melodyChannel);
  const top = extractTopLine(melodySource, barTicks, bars, startTick);
  const intervals = new Array(13).fill(0);
  for (let i = 1; i < top.length; i++) {
    const d = Math.abs(top[i]!.pitch - top[i - 1]!.pitch);
    if (d > 0) intervals[Math.min(12, d)] += 1;
  }
  const pitches = top.map((n) => n.pitch);
  const melodyRange = pitches.length > 1 ? Math.max(...pitches) - Math.min(...pitches) : 0;
  // 旋律音符のうち拍頭から外れている割合
  const offbeat = top.filter((n) => {
    const posInBeat = ((n.tick - startTick) / beatTicks) % 1;
    return Math.min(posInBeat, 1 - posInBeat) > 0.08;
  }).length;

  const sections = detectSections(notes, barTicks, bars, startTick);

  // ---- セクション別のドラム構成と密度 (energy 別ドラム統計用) ----
  const drumNotes = notes.filter((n) => n.channel === 9);
  const nonDrumOnsets = notes.filter((n) => n.channel !== 9).map((n) => n.tick);
  const sectionStats: MidiFeatures["sectionStats"] = [];
  let sectionStartBar = 0;
  for (const len of sections) {
    const from = startTick + sectionStartBar * barTicks;
    const to = from + len * barTicks;
    const hits = drumNotes.filter((n) => n.tick >= from && n.tick < to);
    const onsets = nonDrumOnsets.filter((t) => t >= from && t < to).length;
    const shares: Record<string, number> = {};
    for (const n of hits) shares[String(n.pitch)] = (shares[String(n.pitch)] ?? 0) + 1;
    const total = hits.length;
    sectionStats.push({
      bars: len,
      density: round(onsets / Math.max(1, len), 2),
      drumTotal: total,
      drumShares: total === 0 ? {} : Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, round(v / total, 3)])),
    });
    sectionStartBar += len;
  }

  // ---- ベース声部 (GM 32-39。無ければ低音域から代用) ----
  const nonDrum = notes.filter((n) => n.channel !== 9);
  const bassProgramNotes = nonDrum.filter((n) => n.program >= 32 && n.program <= 39);
  const bassSource = bassProgramNotes.length >= 4 ? bassProgramNotes : nonDrum.filter((n) => n.pitch < 52);
  const bassSorted = [...bassSource].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const bassLine: ParsedNote[] = [];
  for (const n of bassSorted) {
    if (bassLine.length === 0 || n.tick > bassLine[bassLine.length - 1]!.tick) bassLine.push(n);
  }
  const motion = new Array(12).fill(0);
  for (let i = 1; i < bassLine.length; i++) {
    motion[(((bassLine[i]!.pitch - bassLine[i - 1]!.pitch) % 12) + 12) % 12] += 1;
  }
  const motionTotal = motion.reduce((a, b) => a + b, 0);
  const shareOfMotion = (bins: number[]) =>
    motionTotal === 0 ? 0 : round(bins.reduce((a, b) => a + (motion[b] ?? 0), 0) / motionTotal, 3);
  const bassPitches = bassLine.map((n) => n.pitch);
  const bassStats = {
    notesPerBar: round(bassLine.length / bars, 2),
    medianPitch: round(median(bassPitches), 1),
    motionHistogram: normalizeHistogram(motion),
    fifthShare: shareOfMotion([5, 7]),
    stepShare: shareOfMotion([1, 2]),
    leapShare: motionTotal === 0 ? 0 : round(motion.slice(8).reduce((a, b) => a + b, 0) / motionTotal, 3),
  };

  // ---- 旋律の質感 (トップライン) ----
  const gaps: number[] = [];
  for (let i = 1; i < top.length; i++) {
    const gapBeats = (top[i]!.tick - (top[i - 1]!.tick + top[i - 1]!.durationTicks)) / beatTicks;
    if (gapBeats > 0.05) gaps.push(gapBeats);
  }
  const restRatio = top.length === 0 ? 0 : round(gaps.filter((g) => g >= 0.5).length / top.length, 3);
  const intervalTotal = intervals.reduce((a, b) => a + b, 0);
  const melodyStats = {
    medianPitch: round(median(pitches), 1),
    stepwiseShare: intervalTotal === 0 ? 0 : round((intervals[1]! + intervals[2]!) / intervalTotal, 3),
    restRatio,
    medianDuration16: round(median(top.map((n) => (n.durationTicks / beatTicks) * 4)), 1),
  };

  // ---- 和声の色 (sus / 7th) ----
  const qualityTotal = Object.values(harmony.qualities).reduce((a, b) => a + b, 0);
  const qualityOf = (names: string[]) =>
    qualityTotal === 0 ? 0 : round(names.reduce((a, q) => a + (harmony.qualities[q] ?? 0), 0) / qualityTotal, 3);

  // ---- 楽器ファミリー別の密度・音域 ----
  const familyNotes = new Map<string, number[]>();
  for (const n of nonDrum) {
    const fam = programFamily(n.program);
    (familyNotes.get(fam) ?? familyNotes.set(fam, []).get(fam)!).push(n.pitch);
  }
  const familyStats: Record<string, { notes: number; notesPerBar: number; medianPitch: number }> = {};
  for (const [fam, pitchesOfFamily] of familyNotes) {
    familyStats[fam] = {
      notes: pitchesOfFamily.length,
      notesPerBar: round(pitchesOfFamily.length / bars, 2),
      medianPitch: round(median(pitchesOfFamily), 1),
    };
  }

  // ---- ドラムのフィル統計 (トム/スネアの集中する小節) ----
  const TOM_PITCHES = new Set([41, 43, 45, 47, 48, 50]);
  const SNARE_PITCHES = new Set([38, 40]);
  const drumFills = { barsWithDrums: 0, fillBars: 0, phraseEndBars: 0, phraseEndFills: 0 };
  for (let bar = 0; bar < bars; bar++) {
    const from = startTick + bar * barTicks;
    const to = from + barTicks;
    const hits = drumNotes.filter((n) => n.tick >= from && n.tick < to);
    if (hits.length === 0) continue;
    drumFills.barsWithDrums++;
    const isPhraseEnd = bar % 4 === 3;
    if (isPhraseEnd) drumFills.phraseEndBars++;
    const toms = hits.filter((n) => TOM_PITCHES.has(n.pitch)).length;
    const snares = hits.filter((n) => SNARE_PITCHES.has(n.pitch)).length;
    const isFill = toms >= 2 || snares >= 6;
    if (isFill) {
      drumFills.fillBars++;
      if (isPhraseEnd) drumFills.phraseEndFills++;
    }
  }

  return {
    name,
    durationSec,
    bpm,
    bpmMin,
    bpmMax,
    timeSignature: ts,
    bars,
    barTicks,
    barInference: barInference.source,
    barConfidence: barInference.confidence,
    stepsPerBar,
    key: key.key,
    keyConfidence: key.confidence,
    tracks: midi.tracks.length,
    channels: new Set(notes.map((n) => n.channel)).size,
    noteCount: notes.length,
    density,
    polyphonyMean,
    programs,
    drumHits,
    beatPos12: normalizeHistogram(beatPos),
    durations16: normalizeHistogram(durations),
    downbeatShare: rhythmTotal === 0 ? 0 : round(downbeat / rhythmTotal, 3),
    offbeat8thShare: rhythmTotal === 0 ? 0 : round(offbeat8th / rhythmTotal, 3),
    sixteenthShare: rhythmTotal === 0 ? 0 : round(sixteenth / rhythmTotal, 3),
    offGridShare: rhythmTotal === 0 ? 0 : round(triplet / rhythmTotal, 3),
    quantizationUnitBeats: round(unit / beatTicks, 4),
    chordsPerBar: harmony.chordsPerBar,
    chordQualities: harmony.qualities,
    romanBigrams: harmony.bigrams,
    borrowedRate: harmony.borrowedRate,
    sectionBars: sections,
    sectionStats,
    intervalHistogram: normalizeHistogram(intervals),
    melodyRange,
    melodyNotesPerBar: round(top.length / bars, 2),
    offbeatRatio: top.length === 0 ? 0 : round(offbeat / top.length, 3),
    bass: bassStats,
    melody: melodyStats,
    susShare: qualityOf(["sus4", "sus2"]),
    seventhShare: qualityOf(["maj7", "m7", "7", "dim7", "m7b5"]),
    familyStats,
    drumFills,
  };
}

function mostCommonTimeSignature(midi: ParsedMidi): [number, number] {
  const counts = new Map<string, { n: [number, number]; c: number }>();
  for (const ts of midi.timeSignatures) {
    const k = `${ts.numerator}/${ts.denominator}`;
    const cur = counts.get(k);
    if (cur) cur.c += 1; else counts.set(k, { n: [ts.numerator, ts.denominator], c: 1 });
  }
  let best: { n: [number, number]; c: number } = { n: [4, 4], c: 0 };
  for (const v of counts.values()) if (v.c > best.c) best = v;
  return best.n;
}

/** GM 音色番号 → 楽器ファミリー */
export function programFamily(program: number): string {
  if (program <= 7) return "piano";
  if (program <= 15) return "chromatic";
  if (program <= 23) return "organ";
  if (program <= 31) return "guitar";
  if (program <= 39) return "bass";
  if (program <= 47) return "strings";
  if (program <= 55) return "ensemble";
  if (program <= 63) return "brass";
  if (program <= 79) return "reed";
  if (program <= 95) return "synthLead";
  if (program <= 103) return "synthPad";
  if (program <= 111) return "synthFx";
  return "percussive";
}


