/**
 * 解析済み MIDI 特徴を「生成に使える統計プロファイル」へ集計する。
 * 保存・再配布するのは集計値のみ (旋律や譜面そのものは含めない)。
 */

import { parseKeyName } from "../theory/key";
import { programFamily, type MidiFeatures } from "./features";

export const CORPUS_PROFILE_VERSION = 1;

export type CorpusProfile = {
  version: number;
  generatedAt: string;
  source: {
    label: string;
    files: number;
    analyzed: number;
    skipped: number;
    /** 拍節を実測推定したファイルの割合 */
    inferredBarShare: number;
  };
  tempo: { median: number; p10: number; p90: number; buckets: Record<string, number> };
  meters: Record<string, number>;
  keys: Record<string, number>;
  modeShare: { major: number; minor: number };
  /** 楽器ファミリーの出現割合 (ノート数ベース) */
  instruments: Record<string, number>;
  /** ドラム GM 番号の出現割合 */
  drums: Record<string, number>;
  rhythm: {
    /** 小節内16ステップの平均オンセット分布 (合計1) */
    beatPos16: number[];
    downbeatShare: number;
    offbeat8thShare: number;
    sixteenthShare: number;
    offGridShare: number;
    /** 音価 (16分単位) の平均分布 (合計1) */
    durations16: number[];
    medianMelodyNotesPerBar: number;
    medianMelodyRange: number;
  };
  harmony: {
    medianChordsPerBar: number;
    qualities: Record<string, number>;
    borrowedRate: number;
    /** ローマ数字の2連 (上位) */
    topBigrams: { pair: string; share: number }[];
    /** 4小節窓のローマ数字列 (上位) */
    topProgressions: { numerals: string; share: number }[];
  };
  form: {
    medianSectionBars: number;
    /** セクション長の分位点 [p10, p50, p90] */
    sectionBarPercentiles: [number, number, number];
    /** 1曲あたりのセクション数の中央値 */
    medianSections: number;
  };
  /** 生成プロンプトにそのまま差し込める知見 (自動生成) */
  insights: string[];
};

const round = (x: number, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const median = (values: number[]) => quantile(values, 0.5);

/** 配列を合計1に正規化 */
function share(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  return sum === 0 ? values.map(() => 0) : values.map((v) => round(v / sum, 4));
}

function averageHistograms(hists: number[][]): number[] {
  const len = Math.max(...hists.map((h) => h.length), 0);
  if (len === 0) return [];
  const sum = new Array(len).fill(0);
  for (const h of hists) for (let i = 0; i < h.length; i++) sum[i] += h[i] ?? 0;
  return share(sum);
}

function topShare(counts: Map<string, number>, k: number, total: number): { pair: string; share: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([pair, c]) => ({ pair, share: round(c / Math.max(1, total), 3) }));
}

function topNumerals(counts: Map<string, number>, k: number, total: number): { numerals: string; share: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([numerals, c]) => ({ numerals, share: round(c / Math.max(1, total), 3) }));
}

export type AggregateOptions = {
  label?: string;
  /** この割合以上のファイルで使われた要素だけ残す (ノイズ除去) */
  minPresence?: number;
  /** 調推定の信頼度がこれ未満のファイルは和声統計から除外 */
  minKeyConfidence?: number;
};

export function aggregateFeatures(features: MidiFeatures[], opts: AggregateOptions = {}): CorpusProfile {
  const label = opts.label ?? "midi-corpus";
  const minKeyConfidence = opts.minKeyConfidence ?? -1;

  // ---- テンポ ----
  const bpms = features.map((f) => f.bpm).filter((b) => b >= 30 && b <= 300);
  const tempoBuckets: Record<string, number> = {};
  for (const b of bpms) {
    const bucket = `${Math.floor(b / 10) * 10}-${Math.floor(b / 10) * 10 + 9}`;
    tempoBuckets[bucket] = (tempoBuckets[bucket] ?? 0) + 1;
  }
  for (const k of Object.keys(tempoBuckets)) tempoBuckets[k] = round(tempoBuckets[k]! / Math.max(1, bpms.length), 3);

  // ---- 拍子・調 ----
  const meterCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();
  let major = 0;
  let minor = 0;
  for (const f of features) {
    const meter = `${f.timeSignature[0]}/${f.timeSignature[1]}`;
    meterCounts.set(meter, (meterCounts.get(meter) ?? 0) + 1);
    keyCounts.set(f.key, (keyCounts.get(f.key) ?? 0) + 1);
    if (parseKeyName(f.key).mode === "minor") minor++; else major++;
  }
  const meters: Record<string, number> = {};
  for (const [k, v] of meterCounts) meters[k] = round(v / features.length, 3);
  const keys: Record<string, number> = {};
  for (const [k, v] of [...keyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    keys[k] = round(v / features.length, 3);
  }

  // ---- 楽器・ドラム ----
  const familyCounts = new Map<string, number>();
  const drumCounts = new Map<string, number>();
  let noteTotal = 0;
  let drumTotal = 0;
  for (const f of features) {
    for (const [program, count] of Object.entries(f.programs)) {
      const fam = programFamily(Number(program));
      familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + count);
      noteTotal += count;
    }
    for (const [pitch, count] of Object.entries(f.drumHits)) {
      drumCounts.set(pitch, (drumCounts.get(pitch) ?? 0) + count);
      drumTotal += count;
    }
  }
  const instruments: Record<string, number> = {};
  for (const [k, v] of [...familyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    instruments[k] = round(v / Math.max(1, noteTotal), 3);
  }
  const drums: Record<string, number> = {};
  for (const [k, v] of [...drumCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    drums[k] = round(v / Math.max(1, drumTotal), 3);
  }

  // ---- リズム ----
  const rhythmFiles = features.filter((f) => f.stepsPerBar <= 24);
  const beatPos16 = averageHistograms(rhythmFiles.map((f) => f.beatPos12));
  const durations16 = averageHistograms(features.map((f) => f.durations16));
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  // ---- 和声 ----
  const harmonyFiles = features.filter((f) => f.keyConfidence >= minKeyConfidence);
  const qualityCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  let bigramTotal = 0;
  for (const f of harmonyFiles) {
    for (const [q, c] of Object.entries(f.chordQualities)) qualityCounts.set(q, (qualityCounts.get(q) ?? 0) + c);
    for (const [pair, c] of Object.entries(f.romanBigrams)) {
      bigramCounts.set(pair, (bigramCounts.get(pair) ?? 0) + c);
      bigramTotal += c;
    }
  }
  const qualities: Record<string, number> = {};
  const qualityTotal = [...qualityCounts.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...qualityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    qualities[k] = round(v / Math.max(1, qualityTotal), 3);
  }

  // 4小節の進行パターン (2連を連結して近似)
  const progressionCounts = new Map<string, number>();
  for (const f of harmonyFiles) {
    const pairs = Object.keys(f.romanBigrams);
    for (let i = 0; i < pairs.length - 1; i++) {
      const [a1, b1] = pairs[i]!.split(">");
      const [a2, b2] = pairs[i + 1]!.split(">");
      if (b1 === a2 && a1 && b2) {
        const key = `${a1}>${b1}>${b2}`;
        progressionCounts.set(key, (progressionCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const progressionTotal = [...progressionCounts.values()].reduce((a, b) => a + b, 0);

  // ---- 構成 ----
  const sectionLengths = features.flatMap((f) => f.sectionBars.filter((x) => x >= 2 && x <= 64));
  const sectionsPerFile = features.map((f) => f.sectionBars.length);

  const profile: CorpusProfile = {
    version: CORPUS_PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      label,
      files: features.length,
      analyzed: features.length,
      skipped: 0,
      inferredBarShare: round(features.filter((f) => f.barInference === "inferred").length / Math.max(1, features.length), 3),
    },
    tempo: {
      median: round(median(bpms), 1),
      p10: round(quantile(bpms, 0.1), 1),
      p90: round(quantile(bpms, 0.9), 1),
      buckets: tempoBuckets,
    },
    meters,
    keys,
    modeShare: { major: round(major / Math.max(1, features.length), 3), minor: round(minor / Math.max(1, features.length), 3) },
    instruments,
    drums,
    rhythm: {
      beatPos16,
      downbeatShare: round(mean(rhythmFiles.map((f) => f.downbeatShare)), 3),
      offbeat8thShare: round(mean(rhythmFiles.map((f) => f.offbeat8thShare)), 3),
      sixteenthShare: round(mean(rhythmFiles.map((f) => f.sixteenthShare)), 3),
      offGridShare: round(mean(rhythmFiles.map((f) => f.offGridShare)), 3),
      durations16,
      medianMelodyNotesPerBar: round(median(features.map((f) => f.melodyNotesPerBar)), 2),
      medianMelodyRange: round(median(features.map((f) => f.melodyRange)), 1),
    },
    harmony: {
      medianChordsPerBar: round(median(harmonyFiles.map((f) => f.chordsPerBar)), 2),
      qualities,
      borrowedRate: round(mean(harmonyFiles.map((f) => f.borrowedRate)), 3),
      topBigrams: topShare(bigramCounts, 10, bigramTotal),
      topProgressions: topNumerals(progressionCounts, 6, progressionTotal),
    },
    form: {
      medianSectionBars: round(median(sectionLengths), 1),
      sectionBarPercentiles: [
        round(quantile(sectionLengths, 0.1), 1),
        round(quantile(sectionLengths, 0.5), 1),
        round(quantile(sectionLengths, 0.9), 1),
      ],
      medianSections: round(median(sectionsPerFile), 1),
    },
    insights: [],
  };
  profile.insights = buildInsights(profile);
  return profile;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** プロファイルから、生成プロンプトへ差し込む知見を作る */
export function buildInsights(p: CorpusProfile): string[] {
  const out: string[] = [];
  if (p.tempo.p90 - p.tempo.p10 < 5) {
    // メタデータ上のテンポが全曲同一 = 作者の書き出し規約。スタイル判断には使えない
    out.push(
      `Tempo: the tempo metadata is uniform at ${p.tempo.median} BPM across this corpus (authoring convention), ` +
      `so do not use tempo as a style prior — vary tempo to fit the request.`,
    );
  } else {
    out.push(`Tempo: commonly ${p.tempo.p10}-${p.tempo.p90} BPM (median ${p.tempo.median}). Runaway fast/slow tempos are rare.`);
  }

  const topMeter = Object.entries(p.meters).sort((a, b) => b[1] - a[1])[0];
  if (topMeter && topMeter[1] > 0.5) out.push(`Meter: ${topMeter[0]} dominates (${pct(topMeter[1])}); other meters are special cases.`);

  // 長調/短調は「どちらが多数か」だけを述べ、特定モードへ誘導しない。
  // (以前は「minor is common, so don't default to major」と短調寄りに指示していたため、
  //  ゲーム/戦闘系リクエストがほぼ毎回短調になる一因になっていた)
  const majorShare = p.modeShare.major;
  const minorShare = p.modeShare.minor;
  if (Math.abs(majorShare - minorShare) < 0.15) {
    out.push(
      `Mode: major ${pct(majorShare)} / minor ${pct(minorShare)} — the corpus uses both about equally; ` +
      `match the mode to the request (bright/heroic material tends major) and do not default to minor.`,
    );
  } else if (majorShare > minorShare) {
    out.push(
      `Mode: major ${pct(majorShare)} / minor ${pct(minorShare)} — major is more common; ` +
      `prefer major unless the request asks for a dark, sad or tense mood.`,
    );
  } else {
    out.push(
      `Mode: major ${pct(majorShare)} / minor ${pct(minorShare)} — minor is a little more common here; ` +
      `both modes are normal, so choose by the requested mood instead of defaulting.`,
    );
  }

  const topInst = Object.entries(p.instruments).slice(0, 4).map(([k, v]) => `${k} ${pct(v)}`);
  if (topInst.length > 0) out.push(`Instrument focus (by note count): ${topInst.join(", ")}.`);

  const topDrums = Object.entries(p.drums).slice(0, 4).map(([k, v]) => `${drumName(Number(k))} ${pct(v)}`);
  if (topDrums.length > 0) out.push(`Drum emphasis: ${topDrums.join(", ")}.`);

  out.push(
    `Rhythm: downbeat onsets ${pct(p.rhythm.downbeatShare)}, off-beat 8ths ${pct(p.rhythm.offbeat8thShare)}, ` +
    `16ths ${pct(p.rhythm.sixteenthShare)}${p.rhythm.offGridShare > 0.02 ? `, other subdivisions ${pct(p.rhythm.offGridShare)}` : ""}.`,
  );
  out.push(`Harmonic rhythm: about ${p.harmony.medianChordsPerBar} chord(s) per bar; borrowed/secondary chords in about ${pct(p.harmony.borrowedRate)} of chord slots.`);

  const qualities = Object.entries(p.harmony.qualities).slice(0, 4).map(([k, v]) => `${k || "triad"} ${pct(v)}`);
  if (qualities.length > 0) out.push(`Chord qualities: ${qualities.join(", ")}.`);

  if (p.harmony.topBigrams.length > 0) {
    // 同じ和音の連続は「進行」としての情報量が少ないので知見からは外す
    const moves = p.harmony.topBigrams.filter((b) => {
      const [a, b2] = b.pair.split(">");
      return a !== b2;
    });
    if (moves.length > 0) {
      out.push(`Common moves (roman, from→to): ${moves.slice(0, 6).map((b) => `${b.pair.replace(">", "→")} ${pct(b.share)}`).join(", ")}.`);
    }
  }
  if (p.harmony.topProgressions.length > 0) {
    out.push(`Common 3-chord cells: ${p.harmony.topProgressions.slice(0, 4).map((b) => b.numerals.replace(/>/g, "–")).join(" / ")}.`);
  }
  out.push(`Form: sections usually ${p.form.sectionBarPercentiles[0]}-${p.form.sectionBarPercentiles[2]} bars (median ${p.form.medianSectionBars}); about ${p.form.medianSections} sections per piece.`);
  return out;
}

const DRUM_NAMES: Record<number, string> = {
  35: "acousticBassDrum", 36: "bassDrum", 37: "sideStick", 38: "snare", 39: "handClap",
  40: "electricSnare", 41: "lowFloorTom", 42: "closedHat", 43: "highFloorTom", 44: "pedalHat",
  45: "lowTom", 46: "openHat", 47: "lowMidTom", 48: "hiMidTom", 49: "crash", 50: "highTom",
  51: "ride", 52: "chineseCymbal", 53: "rideBell", 54: "tambourine", 55: "splash", 57: "crash2",
};

export function drumName(pitch: number): string {
  return DRUM_NAMES[pitch] ?? `drum${pitch}`;
}

