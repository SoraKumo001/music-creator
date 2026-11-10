/**
 * 調・スケール・ダイアトニック和音の知識。
 * ローマ数字解析 (roman.ts) と進行カードの実現 (progressions.ts) の土台になる。
 */

export type Mode = "major" | "minor";

/** 調。root はピッチクラス (0=C) */
export type KeyContext = { root: number; mode: Mode };

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** 調号がフラット側になる長調の主音 (F, Bb, Eb, Ab, Db, Gb) */
const FLAT_MAJOR_ROOTS = new Set([1, 3, 5, 6, 8, 10]);

export const SCALE_STEPS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export type Triad = "maj" | "min" | "dim" | "aug";
export type Seventh = "maj7" | "min7" | "dom7" | "m7b5" | "dim7";
export type ChordQuality =
  | Triad
  | Seventh
  | "sus4"
  | "sus2"
  | "six"
  | "minSix"
  | "dom9"
  | "maj9"
  | "min9"
  | "add9"
  | "five"
  | "minMaj7";

/** 品質 → コード記号の接尾辞 (harmony.ts の QUALITIES と対応) */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  maj7: "maj7",
  min7: "m7",
  dom7: "7",
  m7b5: "m7b5",
  dim7: "dim7",
  sus4: "sus4",
  sus2: "sus2",
  six: "6",
  minSix: "m6",
  dom9: "9",
  maj9: "maj9",
  min9: "m9",
  add9: "add9",
  five: "5",
  minMaj7: "mM7",
};

/** 機能和声の都合で三和音の種類に丸める (7th/9th は三和音 + 拡張として扱う) */
export function baseTriad(q: ChordQuality): Triad {
  switch (q) {
    case "min":
    case "min7":
    case "min9":
    case "minSix":
    case "minMaj7":
      return "min";
    case "dim":
    case "dim7":
    case "m7b5":
      return "dim";
    case "aug":
      return "aug";
    default:
      return "maj";
  }
}

/** "C major" / "A minor" / "F# minor" / "Bb" / "Cm" を解析する */
export function parseKeyName(text: string): KeyContext {
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)$/.exec(text.trim());
  if (!m) return { root: 0, mode: "major" };
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const root = (LETTER[m[1]!.toUpperCase()]! + acc + 12) % 12;
  const word = (m[3] ?? "").toLowerCase();
  const mode: Mode = word === "m" || word.startsWith("min") ? "minor" : "major";
  return { root, mode };
}

/** その調の表記にフラットを使うか (短調は平行長調の調号で決める) */
export function prefersFlat(key: KeyContext): boolean {
  const relativeMajor = key.mode === "major" ? key.root : (key.root + 3) % 12;
  return FLAT_MAJOR_ROOTS.has(relativeMajor);
}

export function pcName(pc: number, flat = false): string {
  return (flat ? FLAT_NAMES : SHARP_NAMES)[(((pc % 12) + 12) % 12)]!;
}

export function keyName(key: KeyContext): string {
  return `${pcName(key.root, prefersFlat(key))} ${key.mode}`;
}

export function scalePcs(key: KeyContext): number[] {
  return SCALE_STEPS[key.mode].map((s) => (key.root + s) % 12);
}

/** 度数のピッチクラス。accidental は -1 (b) / 0 / +1 (#) */
export function degreePc(key: KeyContext, degree: number, accidental = 0): number {
  const step = SCALE_STEPS[key.mode][degree - 1]!;
  return (key.root + step + accidental + 24) % 12;
}

const MAJOR_TRIADS: Triad[] = ["maj", "min", "min", "maj", "maj", "min", "dim"];
const MAJOR_SEVENTHS: Seventh[] = ["maj7", "min7", "min7", "maj7", "dom7", "min7", "m7b5"];
const MINOR_TRIADS: Triad[] = ["min", "dim", "maj", "min", "min", "maj", "maj"];
const MINOR_SEVENTHS: Seventh[] = ["min7", "m7b5", "maj7", "min7", "min7", "maj7", "dom7"];

export function diatonicTriad(key: KeyContext, degree: number): Triad {
  return (key.mode === "major" ? MAJOR_TRIADS : MINOR_TRIADS)[degree - 1]!;
}

export function diatonicSeventh(key: KeyContext, degree: number): Seventh {
  return (key.mode === "major" ? MAJOR_SEVENTHS : MINOR_SEVENTHS)[degree - 1]!;
}

/** 短調では V(長三和音) と vii°(導音上の減三和音) も調内として扱う */
export function acceptedTriads(key: KeyContext, degree: number): Triad[] {
  if (key.mode === "minor") {
    if (degree === 5) return ["min", "maj"];
    if (degree === 7) return ["maj", "dim"];
  }
  return [diatonicTriad(key, degree)];
}

/** ローマ数字の度数・品質から実際のコード記号を作る。b/# が付く場合はその表記に合わせる */
export function degreeChord(key: KeyContext, degree: number, quality: ChordQuality, accidental = 0): string {
  const flat = accidental < 0 ? true : accidental > 0 ? false : prefersFlat(key);
  return pcName(degreePc(key, degree, accidental), flat) + QUALITY_SUFFIX[quality];
}
