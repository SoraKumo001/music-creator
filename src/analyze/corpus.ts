/**
 * 解析済み MIDI 特徴を「生成に使える統計プロファイル」へ集計する。
 * 保存・再配布するのは集計値のみ (旋律や譜面そのものは含めない)。
 */

import { parseKeyName } from "../theory/key";
import { programFamily, type MidiFeatures } from "./features";

export const CORPUS_PROFILE_VERSION = 3;

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
  /**
   * セクション密度 (energy の代理) 別のドラム構成。
   * density は非ドラムのオンセット数 / 小節。
   */
  drumByEnergy: {
    densityTertiles: [number, number];
    low: { sections: number; shares: Record<string, number>; medianHitsPerBar: number; medianDensity: number };
    mid: { sections: number; shares: Record<string, number>; medianHitsPerBar: number; medianDensity: number };
    high: { sections: number; shares: Record<string, number>; medianHitsPerBar: number; medianDensity: number };
  };
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
    /** ドラムの1小節あたりヒット数 (中央値) */
    drumHitsPerBar: number;
    /** ドラムのある小節のうち、フィルとみなせる小節の割合 */
    fillBarShare: number;
    /** フィルのうち 4小節区切りの最後に置かれる割合 */
    fillPhraseEndShare: number;
  };
  harmony: {
    medianChordsPerBar: number;
    qualities: Record<string, number>;
    borrowedRate: number;
    /** sus4/sus2 がコード枠に占める割合 */
    susShare: number;
    /** 7th 系コードの割合 */
    seventhShare: number;
    /** ローマ数字の2連 (上位) */
    topBigrams: { pair: string; share: number }[];
    /** 4小節窓のローマ数字列 (上位) */
    topProgressions: { numerals: string; share: number }[];
  };
  /** ベース声部の傾向 */
  bass: {
    medianNotesPerBar: number;
    medianPitch: number;
    /** 音程 (mod 12) の平均分布 (合計1) */
    motionHistogram: number[];
    /** 完全4度/5度進行の割合 */
    fifthShare: number;
    /** 順次進行の割合 */
    stepShare: number;
    /** 跳躍の割合 */
    leapShare: number;
  };
  /** 旋律の質感 */
  melody: {
    medianPitch: number;
    /** 順次進行の割合 */
    stepwiseShare: number;
    /** フレーズの切れ目 (休符) の割合 */
    restRatio: number;
    /** 音価の中央値 (16分単位) */
    medianDuration16: number;
  };
  /** 楽器ファミリー別の密度・音域 */
  instrumentStats: Record<string, { share: number; medianNotesPerBar: number; medianPitch: number }>;
  form: {
    medianSectionBars: number;
    /** セクション長の分位点 [p10, p50, p90] */
    sectionBarPercentiles: [number, number, number];
    /** 1曲あたりのセクション数の中央値 */
    medianSections: number;
    /**
     * セクション密度の推移 (energy の弧)。
     * ratio は曲内平均密度に対する比。
     */
    densityArc: {
      medianFirstRatio: number;
      medianLastRatio: number;
      /** 最大密度のセクション位置 (0=先頭, 1=末尾) */
      medianPeakPosition: number;
      /** 後半の方が密度が高い曲の割合 */
      risingShare: number;
      /** 後半の方が密度が低い曲の割合 */
      fallingShare: number;
    };
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

  // ---- セクション密度 (energy 代理) 別のドラム構成 ----
  const sectionsWithDrums = features.flatMap((f) =>
    f.sectionStats.filter((s) => s.drumTotal > 0).map((s) => ({ ...s, density: s.density })),
  );
  const energyBuckets = { low: new Map<string, number>(), mid: new Map<string, number>(), high: new Map<string, number>() };
  const bucketHitsPerBar = { low: [] as number[], mid: [] as number[], high: [] as number[] };
  const bucketDensities = { low: [] as number[], mid: [] as number[], high: [] as number[] };
  const bucketSectionCounts = { low: 0, mid: 0, high: 0 };
  let densityTertiles: [number, number] = [0, 0];
  if (sectionsWithDrums.length > 0) {
    const densities = sectionsWithDrums.map((s) => s.density).sort((a, b) => a - b);
    const q1 = quantile(densities, 1 / 3);
    const q2 = quantile(densities, 2 / 3);
    densityTertiles = [round(q1, 2), round(q2, 2)];
    for (const section of sectionsWithDrums) {
      const bucket = section.density <= q1 ? "low" : section.density > q2 ? "high" : "mid";
      bucketSectionCounts[bucket]++;
      bucketHitsPerBar[bucket].push(section.drumTotal / Math.max(1, section.bars));
      bucketDensities[bucket].push(section.density);
      for (const [pitch, shareValue] of Object.entries(section.drumShares)) {
        const hits = shareValue * section.drumTotal;
        energyBuckets[bucket].set(pitch, (energyBuckets[bucket].get(pitch) ?? 0) + hits);
      }
    }
  }
  const sharesOf = (m: Map<string, number>): Record<string, number> => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {};
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) out[k] = round(v / Math.max(1, total), 3);
    return out;
  };

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

  // ---- ベース・旋律・楽器の詳細統計 ----
  const bassStats = {
    medianNotesPerBar: round(median(features.map((f) => f.bass.notesPerBar)), 2),
    medianPitch: round(median(features.map((f) => f.bass.medianPitch)), 1),
    motionHistogram: averageHistograms(features.map((f) => f.bass.motionHistogram)),
    fifthShare: round(mean(features.map((f) => f.bass.fifthShare)), 3),
    stepShare: round(mean(features.map((f) => f.bass.stepShare)), 3),
    leapShare: round(mean(features.map((f) => f.bass.leapShare)), 3),
  };
  const melodyStats = {
    medianPitch: round(median(features.map((f) => f.melody.medianPitch)), 1),
    stepwiseShare: round(mean(features.map((f) => f.melody.stepwiseShare)), 3),
    restRatio: round(mean(features.map((f) => f.melody.restRatio)), 3),
    medianDuration16: round(median(features.map((f) => f.melody.medianDuration16)), 1),
  };
  const familyTotals = new Map<string, number>();
  for (const f of features) {
    for (const [fam, st] of Object.entries(f.familyStats)) {
      familyTotals.set(fam, (familyTotals.get(fam) ?? 0) + st.notes);
    }
  }
  const familyGrandTotal = [...familyTotals.values()].reduce((a, b) => a + b, 0);
  const instrumentStats: CorpusProfile["instrumentStats"] = {};
  for (const [fam, count] of [...familyTotals.entries()].sort((a, b) => b[1] - a[1])) {
    const withFamily = features.filter((f) => (f.familyStats[fam]?.notes ?? 0) > 0);
    instrumentStats[fam] = {
      share: round(count / Math.max(1, familyGrandTotal), 3),
      medianNotesPerBar: round(median(withFamily.map((f) => f.familyStats[fam]!.notesPerBar)), 2),
      medianPitch: round(median(withFamily.map((f) => f.familyStats[fam]!.medianPitch)), 1),
    };
  }

  // ---- セクション密度の弧 (energy の推移) ----
  const arcs = features
    .map((f) => {
      const dens = f.sectionStats.map((s) => s.density).filter((d) => d > 0);
      if (dens.length < 2) return null;
      const meanDensity = dens.reduce((a, b) => a + b, 0) / dens.length;
      const maxIdx = dens.indexOf(Math.max(...dens));
      const first = dens[0]!;
      const last = dens[dens.length - 1]!;
      return {
        firstRatio: first / Math.max(1e-6, meanDensity),
        lastRatio: last / Math.max(1e-6, meanDensity),
        peak: maxIdx / (dens.length - 1),
        rising: last > first * 1.05,
        falling: last < first * 0.95,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const densityArc = {
    medianFirstRatio: round(median(arcs.map((a) => a.firstRatio)), 2),
    medianLastRatio: round(median(arcs.map((a) => a.lastRatio)), 2),
    medianPeakPosition: round(median(arcs.map((a) => a.peak)), 2),
    risingShare: round(arcs.filter((a) => a.rising).length / Math.max(1, arcs.length), 3),
    fallingShare: round(arcs.filter((a) => a.falling).length / Math.max(1, arcs.length), 3),
  };

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
    drumByEnergy: {
      densityTertiles,
      low: {
        sections: bucketSectionCounts.low,
        shares: sharesOf(energyBuckets.low),
        medianHitsPerBar: round(median(bucketHitsPerBar.low), 1),
        medianDensity: round(median(bucketDensities.low), 1),
      },
      mid: {
        sections: bucketSectionCounts.mid,
        shares: sharesOf(energyBuckets.mid),
        medianHitsPerBar: round(median(bucketHitsPerBar.mid), 1),
        medianDensity: round(median(bucketDensities.mid), 1),
      },
      high: {
        sections: bucketSectionCounts.high,
        shares: sharesOf(energyBuckets.high),
        medianHitsPerBar: round(median(bucketHitsPerBar.high), 1),
        medianDensity: round(median(bucketDensities.high), 1),
      },
    },
    rhythm: {
      beatPos16,
      downbeatShare: round(mean(rhythmFiles.map((f) => f.downbeatShare)), 3),
      offbeat8thShare: round(mean(rhythmFiles.map((f) => f.offbeat8thShare)), 3),
      sixteenthShare: round(mean(rhythmFiles.map((f) => f.sixteenthShare)), 3),
      offGridShare: round(mean(rhythmFiles.map((f) => f.offGridShare)), 3),
      durations16,
      medianMelodyNotesPerBar: round(median(features.map((f) => f.melodyNotesPerBar)), 2),
      medianMelodyRange: round(median(features.map((f) => f.melodyRange)), 1),
      drumHitsPerBar: round(median(features.map((f) => Object.values(f.drumHits).reduce((a, b) => a + b, 0) / Math.max(1, f.bars))), 2),
      fillBarShare: round(
        features.reduce((a, f) => a + f.drumFills.fillBars, 0) / Math.max(1, features.reduce((a, f) => a + f.drumFills.barsWithDrums, 0)),
        3,
      ),
      fillPhraseEndShare: round(
        features.reduce((a, f) => a + f.drumFills.phraseEndFills, 0) / Math.max(1, features.reduce((a, f) => a + f.drumFills.fillBars, 0)),
        3,
      ),
    },
    harmony: {
      medianChordsPerBar: round(median(harmonyFiles.map((f) => f.chordsPerBar)), 2),
      qualities,
      borrowedRate: round(mean(harmonyFiles.map((f) => f.borrowedRate)), 3),
      susShare: round(mean(harmonyFiles.map((f) => f.susShare)), 3),
      seventhShare: round(mean(harmonyFiles.map((f) => f.seventhShare)), 3),
      topBigrams: topShare(bigramCounts, 10, bigramTotal),
      topProgressions: topNumerals(progressionCounts, 6, progressionTotal),
    },
    bass: bassStats,
    melody: melodyStats,
    instrumentStats,
    form: {
      medianSectionBars: round(median(sectionLengths), 1),
      sectionBarPercentiles: [
        round(quantile(sectionLengths, 0.1), 1),
        round(quantile(sectionLengths, 0.5), 1),
        round(quantile(sectionLengths, 0.9), 1),
      ],
      medianSections: round(median(sectionsPerFile), 1),
      densityArc,
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

  const energyDrums = (["low", "mid", "high"] as const)
    .map((bucket) => {
      const top = Object.entries(p.drumByEnergy[bucket].shares)
        .slice(0, 3)
        .map(([k, v]) => `${drumName(Number(k))} ${pct(v)}`)
        .join(", ");
      return top ? `${bucket} (${p.drumByEnergy[bucket].medianHitsPerBar} hits/bar): ${top}` : "";
    })
    .filter((s) => s !== "");
  if (energyDrums.length > 0) {
    out.push(
      `Drum emphasis by section density (${p.drumByEnergy.densityTertiles[0]}-${p.drumByEnergy.densityTertiles[1]} onsets/bar): ${energyDrums.join("; ")}.`,
    );
  }
  out.push(
    `Section density targets (onsets/bar): low ${p.drumByEnergy.low.medianDensity}, mid ${p.drumByEnergy.mid.medianDensity}, high ${p.drumByEnergy.high.medianDensity}.`,
  );

  out.push(
    `Rhythm: downbeat onsets ${pct(p.rhythm.downbeatShare)}, off-beat 8ths ${pct(p.rhythm.offbeat8thShare)}, ` +
    `16ths ${pct(p.rhythm.sixteenthShare)}${p.rhythm.offGridShare > 0.02 ? `, other subdivisions ${pct(p.rhythm.offGridShare)}` : ""}.`,
  );
  out.push(`Harmonic rhythm: about ${p.harmony.medianChordsPerBar} chord(s) per bar; borrowed/secondary chords in about ${pct(p.harmony.borrowedRate)} of chord slots.`);

  const qualities = Object.entries(p.harmony.qualities).slice(0, 4).map(([k, v]) => `${k || "triad"} ${pct(v)}`);
  if (qualities.length > 0) out.push(`Chord qualities: ${qualities.join(", ")}${p.harmony.susShare > 0.02 ? `; sus chords ${pct(p.harmony.susShare)}` : ""}${p.harmony.seventhShare > 0.05 ? `, 7th chords ${pct(p.harmony.seventhShare)}` : ""}.`);

  // ベース・旋律の「鳴り方」は編曲の説得力に直結するため、生成プロンプトにも渡す
  out.push(
    `Bass: about ${p.bass.medianNotesPerBar} notes/bar around register ${p.bass.medianPitch}; ` +
    `root motion steps ${pct(p.bass.stepShare)}, 4ths/5ths ${pct(p.bass.fifthShare)}, leaps ${pct(p.bass.leapShare)}.`,
  );
  out.push(
    `Melody: about ${p.rhythm.medianMelodyNotesPerBar} notes/bar (range ~${p.rhythm.medianMelodyRange} semitones), ` +
    `median register ${p.melody.medianPitch}; stepwise motion ${pct(p.melody.stepwiseShare)}, ` +
    `phrase gaps in ${pct(p.melody.restRatio)} of moves, median note length ${p.melody.medianDuration16} (16ths).`,
  );

  const registerSummary = Object.entries(p.instrumentStats)
    .slice(0, 3)
    .map(([fam, s]) => `${fam} ~${s.medianPitch}`);
  if (registerSummary.length > 0) out.push(`Typical registers: ${registerSummary.join(", ")}.`);

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
  const arc = p.form.densityArc;
  if (arc.medianFirstRatio > 0) {
    out.push(
      `Section energy arc: the first section runs at about ${pct(arc.medianFirstRatio)} of the average density and the last at ${pct(arc.medianLastRatio)}; ` +
        `the densest section sits around ${pct(arc.medianPeakPosition)} through the piece ` +
        `(rising ${pct(arc.risingShare)} / falling ${pct(arc.fallingShare)}).`,
    );
  }
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

