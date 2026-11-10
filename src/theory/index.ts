/** 音楽理論ルール層: LLMの出力をコードで補正・制約するための定数と関数 */

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export const CHORDS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
};

/** GM音色番号ごとの実用音域 [low, high] (MIDIノート番号)。未登録は 24-108 */
export const GM_RANGES: Record<number, [number, number]> = {
  0: [21, 108], // Acoustic Grand Piano
  24: [40, 88], // Nylon Guitar
  33: [28, 67], // Electric Bass (finger)
  32: [28, 67], // Acoustic Bass
  40: [55, 103], // Violin
  48: [36, 96], // String Ensemble
  56: [55, 82], // Trumpet
  73: [60, 96], // Flute
};
const DEFAULT_RANGE: [number, number] = [24, 108];

/** ドラムのGMマッピング(チャンネル10) */
export const GM_DRUMS = {
  kick: 36,
  snare: 38,
  closedHat: 42,
  openHat: 46,
  crash: 49,
  ride: 51,
  tomLow: 45,
  tomHigh: 50,
} as const;

export function parseKey(key: string): { root: number; scale: string } {
  const m = /^([A-Ga-g])([#b]?)\s*(major|minor|maj|min|m)?/i.exec(key.trim());
  if (!m) return { root: 0, scale: "major" };
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let root = base[m[1]!.toUpperCase()]!;
  if (m[2] === "#") root += 1;
  if (m[2] === "b") root -= 1;
  const q = (m[3] ?? "major").toLowerCase();
  return { root: (root + 12) % 12, scale: q.startsWith("m") && q !== "major" && q !== "maj" ? "minor" : "major" };
}

export function chordNotes(root: number, quality: string, octaveBase = 48): number[] {
  const iv = CHORDS[quality] ?? CHORDS[""]!;
  return iv.map((i) => octaveBase + root + i);
}

/** 音域内にオクターブ単位で収める */
export function clampToRange(pitch: number, program: number, isDrum: boolean): number {
  if (isDrum) return Math.min(81, Math.max(27, pitch));
  const [lo, hi] = GM_RANGES[program] ?? DEFAULT_RANGE;
  let p = pitch;
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}

/** 調外音をスケール内の最寄り音へ寄せる(strict指定時のみ使用) */
export function snapToScale(pitch: number, key: string): number {
  const { root, scale } = parseKey(key);
  const set = new Set(SCALES[scale]!.map((i) => (i + root) % 12));
  for (let d = 0; d <= 6; d++) {
    if (set.has(((pitch - d) % 12 + 12) % 12)) return pitch - d;
    if (set.has((pitch + d) % 12)) return pitch + d;
  }
  return pitch;
}
