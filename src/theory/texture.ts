/**
 * テクスチャ層: パッド・アルペジオ・ハモリを生成して声部数を増やす。
 * 参照MIDIの「多声部・刻み」に寄せるためのルール生成 (決定的)。
 */

import { gainAt, keyAtBeat, sectionAt, type Plan, type Section } from "../plan";
import type { Note } from "../score";
import { parseChord, type Chord } from "./harmony";
import { toSegments, type Arrangement, type ChordEvent } from "./accompaniment";
import { parseKey } from "./index";
import { SCALES } from "./index";
import { parseKeyName } from "./key";
import { voiceProgression } from "./voicing";

const cutsOf = (a: Arrangement) => [...a.sections.map((s) => s.start), a.totalBeats - a.beatsPerBar];
const isEnding = (a: Arrangement, beat: number) => !a.loop && a.sections.length > 0 && beat >= a.totalBeats - a.beatsPerBar - 1e-6;

/** セクションのエネルギー (1-3) */
const energyOf = (s: Section): 1 | 2 | 3 => (s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2);

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** パッド: 小節あたり1回、和音を中高音域で伸ばす (声部を厚くする) */
export function generatePad(events: ChordEvent[], a: Arrangement): Note[] {
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
    // 中高音へ移して薄く鳴らす (コードの二重化)
    const pitches = v.map((p) => (p < 60 ? p + 12 : p)).filter((p) => p <= 91);
    const len = Math.min(seg.len, a.beatsPerBar) - 0.06;
    if (len <= 0.1) continue;
    const g = gainAt(sec, seg.start);
    for (const p of pitches) {
      out.push({
        pitch: p,
        start: seg.start,
        duration: len,
        velocity: Math.max(1, Math.min(127, Math.round(46 * g))),
      });
    }
  }
  return out;
}

/** アルペジオ: 16分でコードトーンを上下する (ゲーム音楽的な刻み) */
export function generateArp(events: ChordEvent[], a: Arrangement, opts: { seed?: number; sixteenth?: boolean } = {}): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  let n = 0;
  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    const energy = energyOf(sec);
    if (energy === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const g = gainAt(sec, seg.start);
    const tones = chordPitches(seg.chord, 72);
    if (tones.length === 0) continue;
    // 上昇→下降の往復パターン
    const seq = tones.length > 1 ? [...tones, ...tones.slice(0, -1).reverse()] : tones;
    // 参照MIDIは16分が常時鳴る。sixteenth 指定時は energy 2 以上すべて16分
    const dense = energy >= 3
      || (energy === 2 && (opts.sixteenth === true || sec.role === "chorus" || sec.role === "prechorus"));
    const step = dense ? 0.25 : 0.5;
    for (let s = 0, i = 0; s < seg.len - 0.05; s += step, i++) {
      const pitch = seq[i % seq.length]!;
      out.push({
        pitch,
        start: seg.start + s,
        duration: Math.min(step * 0.9, seg.len - s - 0.02),
        velocity: Math.max(1, Math.min(127, Math.round((s % 1 === 0 ? 62 : 48) * g))),
      });
      n++;
    }
  }
  void opts;
  void n;
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
