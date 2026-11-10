/** コードシンボルの解析と、声部連結つきボイシング */

const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 品質 -> 構成音(ルートからの半音数)。重要度順(3度, 7度, ルート, 5度, テンション) */
const QUALITIES: Record<string, number[]> = {
  "": [4, 0, 7],
  m: [3, 0, 7],
  "7": [4, 10, 0, 7],
  maj7: [4, 11, 0, 7],
  m7: [3, 10, 0, 7],
  m7b5: [3, 10, 0, 6],
  dim: [3, 0, 6],
  dim7: [3, 9, 0, 6],
  aug: [4, 0, 8],
  sus4: [5, 0, 7],
  sus2: [2, 0, 7],
  "6": [4, 9, 0, 7],
  m6: [3, 9, 0, 7],
  "9": [4, 10, 2, 0],
  maj9: [4, 11, 2, 0],
  m9: [3, 10, 2, 0],
  add9: [4, 2, 0, 7],
  "5": [0, 7],
};

const ALIASES: Record<string, string> = {
  M7: "maj7", major7: "maj7", "△7": "maj7", min: "m", min7: "m7", "-7": "m7", "-": "m", dom7: "7",
  "ø": "m7b5", "ø7": "m7b5", "°": "dim", "°7": "dim7", M9: "maj9", min9: "m9", maj: "",
};

export type Chord = { root: number; bass: number; tones: number[]; symbol: string };

function pc(letter: string, acc: string): number {
  return (BASE[letter.toUpperCase()]! + (acc === "#" ? 1 : acc === "b" ? -1 : 0) + 12) % 12;
}

export function parseChord(symbol: string): Chord {
  const m = /^([A-Ga-g])([#b]?)([^/]*)(?:\/([A-Ga-g])([#b]?))?$/.exec(symbol.trim());
  if (!m) throw new Error(`Unrecognized chord symbol: "${symbol}"`);
  const root = pc(m[1]!, m[2]!);
  let q = m[3] ?? "";
  q = ALIASES[q] ?? q;
  const iv = QUALITIES[q] ?? (q.startsWith("m") && !q.startsWith("maj") ? QUALITIES.m7! : QUALITIES[""]!);
  return {
    root,
    bass: m[4] ? pc(m[4], m[5] ?? "") : root,
    tones: iv.map((i) => (root + i) % 12),
    symbol,
  };
}

const LO = 53; // F3
const HI = 79; // G5

/** 構成音(最大4音)を、前のボイシングの中心に近い音域へ置く(声部連結) */
export function voice(chord: Chord, prevCenter: number): number[] {
  const tones = chord.tones.slice(0, 4);
  const used = new Set<number>();
  const out: number[] = [];
  for (const t of tones) {
    let best = -1;
    let bestDist = Infinity;
    for (let p = LO; p <= HI; p++) {
      if (p % 12 !== t || used.has(p)) continue;
      const d = Math.abs(p - prevCenter);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    if (best >= 0) { used.add(best); out.push(best); }
  }
  return out.sort((a, b) => a - b);
}

export function center(notes: number[]): number {
  return notes.reduce((a, b) => a + b, 0) / Math.max(1, notes.length);
}

/** ベース音域(E1-D#3 = 28-50)内のルート音 */
export function bassPitch(pcls: number, octave = 0): number {
  return 36 + (((pcls - 36) % 12) + 12) % 12 + octave * 12;
}
