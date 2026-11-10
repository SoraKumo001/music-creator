/**
 * テクスチャ層: パッド・モチーフ型アルペジオリフ・16分オスティナート・ハモリを生成する。
 * 主旋律が常に最前面・最高音域で聴こえるよう、主旋律が存在する区間では
 * 補助声部の音域上限 (シーリング) とベロシティを自動で抑える (ダイナミック・ダッキング)。
 */

import { gainAt, keyAtBeat, sectionAt, type Plan, type Section } from "../plan";
import type { Note } from "../score";
import { parseChord, type Chord } from "./harmony";
import { toSegments, type Arrangement, type ChordEvent } from "./accompaniment";
import { parseKey, SCALES } from "./index";
import { parseKeyName } from "./key";
import { voiceProgression } from "./voicing";

const cutsOf = (a: Arrangement) => [...a.sections.map((s) => s.start), a.totalBeats - a.beatsPerBar];
const isEnding = (a: Arrangement, beat: number) => !a.loop && a.sections.length > 0 && beat >= a.totalBeats - a.beatsPerBar - 1e-6;

/** セクションのエネルギー (1-3) */
const energyOf = (s: Section): 1 | 2 | 3 => (s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2);

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * 1小節 (16ステップ) のモチーフ型リフ・パターン辞書。
 * 単調な上下往復ではなく、ゲーム音楽特有のペダルポイント・シンコペーション・フック音型を持つ。
 * 数値は chordPitches() のインデックス (0=root, 1=3rd, 2=5th, 3=7th/octave)。
 */
const ARP_RIFF_PATTERNS: readonly (readonly number[])[] = [
  // 0: 3+3+2 トレシロ・フック (頭と裏拍に高音フック)
  [0, 1, 2, 3, 1, 2, 3, 1, 0, 2, 1, 3, 2, 1, 2, 0],
  // 1: ペダル・ギャロップ (ルートを軸に上声部が動くファルコム/STG風)
  [0, 0, 2, 0, 3, 2, 1, 0, 0, 0, 2, 0, 3, 1, 2, 3],
  // 2: 下降シーケンス・フック (高音から駆け下りて跳ね上がる)
  [3, 2, 1, 0, 2, 1, 0, 1, 3, 2, 1, 0, 1, 2, 3, 2],
  // 3: オクターブ・バウンス (推進力のあるシンセリード・バッキング)
  [0, 3, 1, 2, 0, 3, 2, 1, 0, 3, 1, 2, 3, 2, 1, 2],
];

const SEQ16_RIFF_PATTERNS: readonly (readonly number[])[] = [
  // 0: ルートペダル + 5度/3度リフ
  [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 2, 0, 3, 2, 1, 2],
  // 1: シンコペーション・オスティナート (3+3+2 アクセント)
  [0, 2, 1, 0, 2, 1, 0, 2, 0, 3, 2, 1, 0, 2, 1, 2],
  // 2: ドライビング・シーケンス
  [0, 1, 2, 1, 0, 2, 3, 2, 0, 1, 2, 1, 3, 2, 1, 0],
  // 3: 80s アーケード・パルス
  [0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 2, 3, 2, 1],
];

/** 16ステップ内のアクセント重み (3+3+2 シンコペーションと拍頭を強調) */
const STEP16_ACCENT = [
  1.12, 0.78, 0.85, 1.05,
  0.82, 0.78, 1.04, 0.80,
  1.08, 0.78, 0.85, 1.02,
  0.84, 0.78, 0.96, 0.80,
];

/** 指定区間 [from, to) で主旋律が鳴っているか、およびその最低ピッチを返す */
function melodyActivityAt(melody: Note[] | undefined, from: number, to: number): { active: boolean; minPitch: number } {
  if (!melody || melody.length === 0) return { active: false, minPitch: 84 };
  let minPitch = Infinity;
  let active = false;
  for (const n of melody) {
    if (n.start < to - 1e-4 && n.start + n.duration > from + 1e-4) {
      active = true;
      if (n.pitch < minPitch) minPitch = n.pitch;
    }
  }
  return { active, minPitch: active ? minPitch : 84 };
}

/** パッド: 小節あたり1回、和音を中音域で薄く伸ばす (主旋律を邪魔しない音域・音量に抑える) */
export function generatePad(events: ChordEvent[], a: Arrangement, opts: { melody?: Note[] } = {}): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const voicings = voiceProgression(sorted.map((e) => parseChord(e.symbol)));
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    if (energyOf(sec) === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const v = voicings[seg.index] ?? [];
    if (v.length === 0) continue;
    const { active, minPitch } = melodyActivityAt(opts.melody, seg.start, seg.start + seg.len);
    const ceiling = active ? Math.max(67, minPitch - 2) : 84;
    // 60..91 の範囲を保ちつつ、主旋律より上の音はオクターブ下げてマスキングを防ぐ
    const pitches = [...new Set(v.map((p) => {
      let q = p < 60 ? p + 12 : p;
      if (q > ceiling && q - 12 >= 60) q -= 12;
      return q;
    }).filter((p) => p >= 60 && p <= 91))];
    const len = Math.min(seg.len, a.beatsPerBar) - 0.06;
    if (len <= 0.1) continue;
    const g = gainAt(sec, seg.start);
    const baseVel = active ? 38 : 46;
    for (const p of pitches) {
      out.push({
        pitch: p,
        start: seg.start,
        duration: len,
        velocity: Math.max(1, Math.min(127, Math.round(baseVel * g))),
      });
    }
  }
  return out;
}

/**
 * モチーフ型アルペジオリフ:
 * - 曲固有の1小節(16ステップ)リフ・パターンをコード進行に沿って反復する
 * - 主旋律が休んでいる区間 (intro/interlude やブレス隙間) では中高音へ出てフックを聴かせ、
 *   主旋律が歌っている区間では主旋律より低い音域・控えめな音量へ自動でダッキングする
 */
export function generateArp(
  events: ChordEvent[],
  a: Arrangement,
  opts: { seed?: number; sixteenth?: boolean; melody?: Note[] } = {},
): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  const patIdx = Math.abs(opts.seed ?? 0) % ARP_RIFF_PATTERNS.length;
  const riff = ARP_RIFF_PATTERNS[patIdx]!;

  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    const energy = energyOf(sec);
    if (energy === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const g = gainAt(sec, seg.start);
    const isInstrumentalRole = sec.role === "intro" || sec.role === "interlude" || sec.role === "solo";
    // 主旋律がいない区間は高め (64)、いる区間は中低音 (55) を基準にする
    const basePitch = opts.melody ? (isInstrumentalRole ? 64 : 55) : 60;
    const tones = chordPitches(seg.chord, basePitch);
    if (tones.length === 0) continue;

    const dense = energy >= 3
      || (energy === 2 && (opts.sixteenth === true || sec.role === "chorus" || sec.role === "prechorus" || isInstrumentalRole));
    const step = dense ? 0.25 : 0.5;
    for (let s = 0, i = 0; s < seg.len - 0.05; s += step, i++) {
      const beatNow = seg.start + s;
      const stepInBar = Math.round(((beatNow % a.beatsPerBar) / a.beatsPerBar) * 16) % 16;
      const deg = riff[stepInBar] ?? (i % tones.length);
      let pitch = tones[deg % tones.length]!;

      // 主旋律が鳴っている瞬間は、主旋律の最低音より下 (上限66) に折り畳んで主旋律を最前面に出す
      const mel = melodyActivityAt(opts.melody, beatNow, beatNow + step);
      if (mel.active) {
        const ceiling = Math.max(58, Math.min(66, mel.minPitch - 3));
        while (pitch > ceiling && pitch - 12 >= 48) pitch -= 12;
      }
      const accent = STEP16_ACCENT[stepInBar] ?? 0.85;
      const baseV = mel.active ? 44 : 60;
      out.push({
        pitch,
        start: beatNow,
        duration: Math.min(step * 0.88, seg.len - s - 0.02),
        velocity: Math.max(1, Math.min(127, Math.round(baseV * accent * g))),
      });
    }
  }
  return out;
}

/**
 * 16分オスティナート・シーケンス:
 * 曲固有の1小節リフ音型を中低域 (MIDI 55..66) でタイトに刻み、リズムの推進力を作る。
 */
export function generateSeq16(
  events: ChordEvent[],
  a: Arrangement,
  opts: { seed?: number; melody?: Note[] } = {},
): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  const patIdx = Math.abs((opts.seed ?? 0) + 1) % SEQ16_RIFF_PATTERNS.length;
  const riff = SEQ16_RIFF_PATTERNS[patIdx]!;

  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    const energy = energyOf(sec);
    if (energy === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const g = gainAt(sec, seg.start);
    const tones = chordPitches(seg.chord, 55);
    if (tones.length < 2) continue;
    const startBar = Math.ceil(seg.start / a.beatsPerBar) * a.beatsPerBar;
    for (let beat = startBar; beat < seg.start + seg.len - 1e-6; beat += a.beatsPerBar) {
      const barEnd = Math.min(beat + a.beatsPerBar, seg.start + seg.len);
      const mel = melodyActivityAt(opts.melody, beat, barEnd);
      const ceiling = mel.active ? Math.max(60, Math.min(66, mel.minPitch - 3)) : 70;
      for (let s = 0, i = 0; beat + s < barEnd - 0.05; s += 0.25, i++) {
        const deg = riff[i % riff.length]!;
        let pitch = tones[deg % tones.length]!;
        while (pitch > ceiling && pitch - 12 >= 55) pitch -= 12;
        if (pitch < 55) pitch += 12;
        const accent = STEP16_ACCENT[i % 16] ?? 0.85;
        const baseV = mel.active ? 42 : 54;
        out.push({
          pitch,
          start: beat + s,
          duration: 0.22,
          velocity: Math.max(1, Math.min(127, Math.round(baseV * accent * g))),
        });
      }
      if (out.length > 4000) break;
    }
  }
  return out;
}

/** コードの構成音を指定音域付近へ並べる */
function chordPitches(chord: Chord, base: number): number[] {
  const tones = [...new Set(chord.tones)];
  const out: number[] = [];
  for (const t of tones) {
    let p = base + ((t - (base % 12) + 12) % 12);
    if (p < base) p += 12;
    if (p <= 96) out.push(p);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** ハモリ: 主旋律にスケール内の3度下を付ける (長い音だけ) */
export function generateHarmony(melody: Note[], plan: Plan, beatsPerBar: number, opts: { minDuration?: number } = {}): Note[] {
  const minDuration = opts.minDuration ?? 0.5;
  const out: Note[] = [];
  let lastEnd = -1;
  for (const n of [...melody].sort((a, b) => a.start - b.start)) {
    if (n.duration < minDuration || n.start < lastEnd) continue;
    const key = parseKeyName(keyAtBeat(plan, n.start, beatsPerBar));
    const { root, scale } = parseKey(`${NOTE[key.root]} ${key.mode}`);
    const scaleSet = new Set(SCALES[scale]!.map((i) => (i + root) % 12));
    // 3度下 (スケール内) を探す
    let pitch = n.pitch - 3;
    for (let d = 0; d < 6; d++) {
      if (scaleSet.has((pitch - d + 12) % 12)) { pitch -= d; break; }
      if (scaleSet.has((pitch + d) % 12)) { pitch += d; break; }
    }
    if (pitch < 50 || pitch > 96) continue;
    if (Math.abs(pitch - n.pitch) < 2) continue;
    out.push({ ...n, pitch, velocity: Math.max(1, Math.round(n.velocity * 0.72)) });
    lastEnd = n.start + n.duration;
  }
  return out;
}
