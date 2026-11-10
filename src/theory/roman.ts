/**
 * コード記号 → ローマ数字の解析と、その逆（ローマ数字 → コード記号）。
 * 度数・転回形・二次ドミナント・裏コード・借用和音まで扱う。
 */

import { parseChord, type Chord } from "./harmony";
import { functionOf, type Function } from "./functions";
import {
  SCALE_STEPS,
  acceptedTriads,
  baseTriad,
  degreeChord,
  diatonicSeventh,
  diatonicTriad,
  parseKeyName,
  scalePcs,
  type ChordQuality,
  type KeyContext,
  type Mode,
  type Triad,
} from "./key";

export type Analysis = {
  symbol: string;
  root: number;
  bass: number;
  quality: ChordQuality | "other";
  degree: number; // 1..7
  accidental: -1 | 0 | 1;
  numeral: string; // "V7", "bVII", "V7/V"
  inversion: 0 | 1 | 2 | 3;
  fn: Function;
  isDiatonic: boolean;
  borrowedFrom?: "parallelMinor" | "parallelMajor" | "neapolitan" | "tritoneSub" | "mixolydian" | "dorian";
  appliedTo?: number; // 二次ドミナントの対象度数
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** 品質 → ローマ数字の接尾辞 */
const QUALITY_NUMERAL: Record<ChordQuality, string> = {
  maj: "",
  min: "",
  dim: "°",
  aug: "+",
  maj7: "maj7",
  min7: "7",
  dom7: "7",
  m7b5: "ø7",
  dim7: "°7",
  six: "6",
  minSix: "m6",
  dom9: "9",
  maj9: "maj9",
  min9: "m9",
  add9: "add9",
  five: "5",
  minMaj7: "mM7",
  sus4: "sus4",
  sus2: "sus2",
};

const LOWER_QUALITIES = new Set<ChordQuality>(["min", "min7", "m7b5", "dim", "dim7", "minSix", "min9", "minMaj7"]);

/** 構成音の半音集合 → 品質 */
const INTERVAL_QUALITY: Record<string, ChordQuality> = {
  "0,4,7": "maj",
  "0,3,7": "min",
  "0,3,6": "dim",
  "0,4,8": "aug",
  "0,5,7": "sus4",
  "0,2,7": "sus2",
  "0,4,7,10": "dom7",
  "0,4,7,11": "maj7",
  "0,3,7,10": "min7",
  "0,3,6,10": "m7b5",
  "0,3,6,9": "dim7",
  "0,4,7,9": "six",
  "0,3,7,9": "minSix",
  "0,4,7,10,2": "dom9",
  "0,4,7,11,2": "maj9",
  "0,3,7,10,2": "min9",
  "0,4,7,2": "add9",
  "0,7": "five",
  "0,3,7,11": "minMaj7",
};

function qualityOf(chord: Chord): ChordQuality | "other" {
  const key = [...new Set(chord.tones.map((t) => (t - chord.root + 12) % 12))].sort((a, b) => a - b).join(",");
  return INTERVAL_QUALITY[key] ?? "other";
}

/** ベース音が構成音の何番目か (転回形)。構成音でない分数コードは基本形扱い */
function inversionOf(chord: Chord): 0 | 1 | 2 | 3 {
  if (chord.bass === chord.root) return 0;
  const iv = (chord.bass - chord.root + 12) % 12;
  if (iv === 3 || iv === 4) return 1;
  if (iv === 6 || iv === 7 || iv === 8) return 2;
  if (iv === 9 || iv === 10 || iv === 11) return 3;
  return 0;
}

/**
 * ルート音の度数と半音のずれを求める。
 * 半音違いは、慣用的な表記 (bII, bIII, #IV, bVI, bVII) を優先する。
 */
function locateDegree(root: number, key: KeyContext): { degree: number; accidental: -1 | 0 | 1 } {
  const scale = scalePcs(key);
  for (let d = 1; d <= 7; d++) if (scale[d - 1] === root) return { degree: d, accidental: 0 };

  const cands: { degree: number; accidental: -1 | 1; score: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    const pc = scale[d - 1]!;
    if ((pc + 1) % 12 === root) cands.push({ degree: d, accidental: 1, score: d === 4 ? 3 : 0 });
    if ((pc - 1 + 12) % 12 === root) cands.push({ degree: d, accidental: -1, score: [2, 3, 6, 7].includes(d) ? 2 : 0 });
  }
  // 短調の導音 (#VII ではなく vii° と書く)
  if (key.mode === "minor") {
    const lead = cands.find((c) => c.degree === 7 && c.accidental === 1);
    if (lead) lead.score += 2;
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] ?? { degree: 1, accidental: 0 };
}

/** 品質 → ダイアトニック 7th の種類 (三和音・付加音は undefined) */
const SEVENTH_OF: Partial<Record<ChordQuality, "maj7" | "min7" | "dom7" | "m7b5" | "dim7">> = {
  maj7: "maj7",
  maj9: "maj7",
  min7: "min7",
  min9: "min7",
  dom7: "dom7",
  dom9: "dom7",
  m7b5: "m7b5",
  dim7: "dim7",
};

function isDiatonicChord(root: number, quality: ChordQuality | "other", key: KeyContext): boolean {
  if (quality === "other") return false;
  const triad = baseTriad(quality);
  const scale = scalePcs(key);
  for (let d = 1; d <= 7; d++) {
    if (scale[d - 1] !== root) continue;
    if (!acceptedTriads(key, d).includes(triad)) return false;
    const seventh = SEVENTH_OF[quality];
    if (!seventh) return true; // 三和音・sus・付加音
    if (diatonicSeventh(key, d) === seventh) return true;
    if (key.mode === "minor") {
      if (d === 5 && seventh === "dom7") return true; // 和声短調の V7
      if (d === 7 && (seventh === "dim7" || seventh === "m7b5")) return true; // vii°7
    }
    return false;
  }
  // 短調の導音 (第7音を半音上げた和音)
  return key.mode === "minor" && root === (key.root + 11) % 12 && triad === "dim";
}

function matchesParallel(root: number, triad: Triad, key: KeyContext, mode: Mode): boolean {
  const scale = SCALE_STEPS[mode].map((s) => (key.root + s) % 12);
  const table: Triad[] = mode === "major" ? ["maj", "min", "min", "maj", "maj", "min", "dim"] : ["min", "dim", "maj", "min", "min", "maj", "maj"];
  for (let d = 0; d < 7; d++) if (scale[d] === root) return table[d] === triad;
  return false;
}

/** V7/x を判定する。対象が I のときは通常の V7 なので対象外 */
function secondaryDominant(root: number, quality: ChordQuality, key: KeyContext): { target: number; numeral: string } | null {
  if (!(quality === "maj" || quality === "dom7" || quality === "dom9")) return null;
  const targetPc = (root + 5) % 12;
  const target = scalePcs(key).indexOf(targetPc) + 1;
  if (target < 2) return null;
  const label = quality === "dom7" ? "V7" : quality === "dom9" ? "V9" : "V";
  return { target, numeral: `${label}/${targetNumeral(target, key)}` };
}

/** 二次ドミナントの対象を、その調での実際の和音の種類に合わせて表記する (ii, IV, vii° など) */
function targetNumeral(degree: number, key: KeyContext): string {
  const base = ROMAN[degree - 1]!;
  let triad = diatonicTriad(key, degree);
  if (key.mode === "minor") {
    if (degree === 5) triad = "maj"; // 和声短調の V
    if (degree === 7) triad = "dim"; // 導音の vii°
  }
  if (triad === "dim") return `${base.toLowerCase()}°`;
  if (triad === "min") return base.toLowerCase();
  return base;
}

const SEVENTH_QUALITIES = new Set<ChordQuality>(["maj7", "min7", "dom7", "m7b5", "dim7", "minMaj7", "dom9", "maj9", "min9"]);

function inversionSuffix(q: ChordQuality, inv: 0 | 1 | 2 | 3): string {
  if (inv === 0) return "";
  if (SEVENTH_QUALITIES.has(q)) return inv === 1 ? "65" : inv === 2 ? "43" : "42";
  return inv === 1 ? "6" : inv === 2 ? "64" : "";
}

function numeralOf(degree: number, accidental: -1 | 0 | 1, quality: ChordQuality, inversion: 0 | 1 | 2 | 3, mode: Mode): string {
  const base = ROMAN[degree - 1]!;
  const roman = LOWER_QUALITIES.has(quality) ? base.toLowerCase() : base;
  let acc = accidental === -1 ? "b" : accidental === 1 ? "#" : "";
  // 短調の導音は # を付けず vii° と書く
  if (mode === "minor" && degree === 7 && accidental === 1 && baseTriad(quality) === "dim") acc = "";
  // 転回形では数字が 7 を含むため、品質の "7" は省く (V65, V43, V42)
  const inverted = inversion > 0 && (SEVENTH_QUALITIES.has(quality) || quality === "six" || quality === "minSix");
  const suffix = inverted ? "" : QUALITY_NUMERAL[quality];
  return `${acc}${roman}${suffix}${inversionSuffix(quality, inversion)}`;
}

export function analyzeChord(symbol: string, key: KeyContext | string): Analysis {
  const k = typeof key === "string" ? parseKeyName(key) : key;
  const chord = parseChord(symbol);
  const quality = qualityOf(chord);
  const inv = inversionOf(chord);
  const loc = locateDegree(chord.root, k);
  const triad = quality === "other" ? "maj" : baseTriad(quality);
  const diatonic = isDiatonicChord(chord.root, quality, k);

  // 裏コード・ナポリ・借用を先に判定する。
  // 例: A 短調の D は V/v ではなく平行長調からの IV。二次ドミナントより借用を優先する。
  let borrowedFrom: Analysis["borrowedFrom"];
  let secondary: { target: number; numeral: string } | null = null;
  if (!diatonic) {
    const subPc = (chord.root - 1 + 12) % 12;
    if ((quality === "dom7" || quality === "dom9") && subPc === k.root) {
      borrowedFrom = "tritoneSub";
    } else if ((quality === "maj" || quality === "six") && subPc === k.root) {
      borrowedFrom = "neapolitan";
    } else if (k.mode === "major" && matchesParallel(chord.root, triad, k, "minor")) {
      borrowedFrom = "parallelMinor";
    } else if (k.mode === "minor" && matchesParallel(chord.root, triad, k, "major")) {
      // 短調の IV (ドリアンの色) は dorian、それ以外は平行長調からの借用
      borrowedFrom = loc.degree === 4 ? "dorian" : "parallelMajor";
    } else if (quality !== "other") {
      secondary = secondaryDominant(chord.root, quality, k);
    }
  }

  // 二次ドミナント
  if (secondary) {
    return {
      symbol,
      root: chord.root,
      bass: chord.bass,
      quality,
      degree: loc.degree,
      accidental: loc.accidental,
      numeral: secondary.numeral,
      inversion: inv,
      fn: "D",
      isDiatonic: false,
      appliedTo: secondary.target,
    };
  }

  // 長調の IV7 (ブルース/ミクソリディアンの色) は説明可能な借用として扱う
  if (!diatonic && borrowedFrom === undefined && (quality === "dom7" || quality === "dom9") && loc.accidental === 0 && loc.degree === 4 && k.mode === "major") {
    borrowedFrom = "mixolydian";
  }

  return {
    symbol,
    root: chord.root,
    bass: chord.bass,
    quality,
    degree: loc.degree,
    accidental: loc.accidental,
    numeral: numeralOf(loc.degree, loc.accidental, quality === "other" ? "maj" : quality, inv, k.mode),
    inversion: inv,
    fn: functionOf(loc.degree, loc.accidental, quality === "other" ? "maj" : quality, k.mode),
    isDiatonic: diatonic,
    borrowedFrom,
  };
}

// ---- ローマ数字 → コード記号 (進行カードの実現) ----

export type NumeralSpec = { degree: number; accidental: -1 | 0 | 1; quality: ChordQuality };

function qualityFromSuffix(suffix: string, lower: boolean): ChordQuality {
  switch (suffix) {
    case "":
      return lower ? "min" : "maj";
    case "7":
      return lower ? "min7" : "dom7";
    case "maj7":
      return "maj7";
    case "m7":
      return "min7";
    case "ø7":
    case "m7b5":
      return "m7b5";
    case "°7":
    case "dim7":
      return "dim7";
    case "°":
    case "dim":
      return "dim";
    case "+":
    case "aug":
      return "aug";
    case "6":
      return lower ? "minSix" : "six";
    case "m6":
      return "minSix";
    case "9":
      return "dom9";
    case "maj9":
      return "maj9";
    case "m9":
      return "min9";
    case "add9":
      return "add9";
    case "sus4":
      return "sus4";
    case "sus2":
      return "sus2";
    case "5":
      return "five";
    case "mM7":
      return "minMaj7";
    default:
      throw new Error(`Unknown numeral suffix: "${suffix}"`);
  }
}

/** "IVmaj7" / "vii°" / "bVII" を度数・品質へ。二次ドミナント (V7/V) は非対応 */
export function parseNumeral(numeral: string): NumeralSpec {
  const m = /^([b#]?)([ivIV]+)([^/]*)$/.exec(numeral.trim());
  if (!m) throw new Error(`Unrecognized numeral: "${numeral}"`);
  const roman = m[2]!;
  const degree = ROMAN.indexOf(roman.toUpperCase()) + 1;
  if (degree < 1) throw new Error(`Unrecognized numeral: "${numeral}"`);
  const accidental: -1 | 0 | 1 = m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0;
  return { degree, accidental, quality: qualityFromSuffix(m[3]!, roman === roman.toLowerCase()) };
}

export function realizeNumeral(numeral: string, key: KeyContext | string): string {
  const k = typeof key === "string" ? parseKeyName(key) : key;
  const { degree, accidental, quality } = parseNumeral(numeral);
  return degreeChord(k, degree, quality, accidental);
}

/** 進行カードの実現 (一括) */
export function realizeNumerals(numerals: string[], key: KeyContext | string): string[] {
  return numerals.map((n) => realizeNumeral(n, key));
}
