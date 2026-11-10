/**
 * オーケストラ編成のパート生成。
 * 旋律は第1ヴァイオリン、和音は弦のコラール、低音はチェロ/コントラバス/テューバ、
 * 木管・金管・打楽器・ハープをセクションのエネルギーに応じて重ねる。
 *
 * 16 MIDI チャンネルに収めるため、同音色のパート (Violin I/II, Flute 1/2,
 * Oboe 1/2, Clarinet 1/2, Bassoon 1/2, Horn 1/2, Trumpet 1/2, Trombone 1/2)
 * はチャンネルを共有するディヴィジ編成。
 */

import { sectionAt, type Plan, type Section } from "../plan";
import type { Note, Track } from "../score";
import { chordAt, toSegments, type ChordEvent } from "./accompaniment";
import { bassPitch } from "./harmony";
import { voiceProgression } from "./voicing";

export type OrchestraPart = {
  id: string;
  name: string;
  program: number;
  channel: number;
  range: [number, number];
};

/**
 * 26 パート。メロディックな 15 プログラムを 15 チャンネルに割り当て、
 * 同音色のパートはチャンネルを共有する。打楽器はチャンネル 9 (GM ドラム)。
 */
export const ORCHESTRA_PARTS: OrchestraPart[] = [
  { id: "violin1", name: "Violin I", program: 40, channel: 0, range: [55, 103] },
  { id: "violin2", name: "Violin II", program: 40, channel: 0, range: [55, 100] },
  { id: "viola", name: "Viola", program: 41, channel: 1, range: [48, 91] },
  { id: "cello", name: "Cello", program: 42, channel: 2, range: [36, 76] },
  { id: "contrabass", name: "Contrabass", program: 43, channel: 3, range: [28, 67] },
  { id: "piccolo", name: "Piccolo", program: 72, channel: 4, range: [74, 105] },
  { id: "flute1", name: "Flute 1", program: 73, channel: 5, range: [60, 96] },
  { id: "flute2", name: "Flute 2", program: 73, channel: 5, range: [60, 96] },
  { id: "oboe1", name: "Oboe 1", program: 68, channel: 6, range: [58, 91] },
  { id: "oboe2", name: "Oboe 2", program: 68, channel: 6, range: [58, 91] },
  { id: "clarinet1", name: "Clarinet 1", program: 71, channel: 7, range: [50, 91] },
  { id: "clarinet2", name: "Clarinet 2", program: 71, channel: 7, range: [50, 91] },
  { id: "bassoon1", name: "Bassoon 1", program: 70, channel: 8, range: [34, 72] },
  { id: "bassoon2", name: "Bassoon 2", program: 70, channel: 8, range: [34, 72] },
  { id: "horn1", name: "Horn 1", program: 60, channel: 10, range: [41, 77] },
  { id: "horn2", name: "Horn 2", program: 60, channel: 10, range: [41, 77] },
  { id: "trumpet1", name: "Trumpet 1", program: 56, channel: 11, range: [55, 82] },
  { id: "trumpet2", name: "Trumpet 2", program: 56, channel: 11, range: [55, 82] },
  { id: "trombone1", name: "Trombone 1", program: 57, channel: 12, range: [40, 72] },
  { id: "trombone2", name: "Trombone 2", program: 57, channel: 12, range: [40, 72] },
  { id: "tuba", name: "Tuba", program: 58, channel: 13, range: [28, 60] },
  { id: "timpani", name: "Timpani", program: 47, channel: 14, range: [41, 57] },
  { id: "harp", name: "Harp", program: 46, channel: 15, range: [24, 103] },
  { id: "bassdrum", name: "Bass Drum", program: 0, channel: 9, range: [36, 36] },
  { id: "snare", name: "Snare Drum", program: 0, channel: 9, range: [38, 38] },
  { id: "cymbals", name: "Cymbals", program: 0, channel: 9, range: [49, 49] },
];

const BY_ID = new Map(ORCHESTRA_PARTS.map((p) => [p.id, p]));

function clamp(pitch: number, [lo, hi]: [number, number]): number {
  let p = pitch;
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return Math.max(lo, Math.min(hi, p));
}

/** Section.gain からエネルギー (1〜3) を戻す */
const energyOf = (s: Section): 1 | 2 | 3 => (s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2);

export function generateOrchestra(plan: Plan, sections: Section[], melody: Note[], bars: number, beatsPerBar: number): Track[] {
  const totalBeats = bars * beatsPerBar;
  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const segments = toSegments(events, totalBeats, sections.map((s) => s.start));
  const voicings = voiceProgression(segments.map((s) => s.chord));

  const notes = new Map<string, Note[]>();
  const add = (id: string, pitch: number, start: number, duration: number, velocity: number) => {
    const part = BY_ID.get(id)!;
    const list = notes.get(id);
    const note: Note = {
      pitch: clamp(pitch, part.range),
      start,
      duration: Math.max(0.0625, duration),
      velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    };
    if (list) list.push(note);
    else notes.set(id, [note]);
  };

  // 旋律: 第1ヴァイオリン。エネルギーに応じてオーボエ/フルート/ピッコロが重ねる
  for (const n of melody) {
    const energy = energyOf(sectionAt(sections, n.start));
    add("violin1", n.pitch, n.start, n.duration, n.velocity);
    if (energy >= 2) add("oboe1", n.pitch, n.start, n.duration, n.velocity * 0.8);
    if (energy >= 3) {
      add("flute1", n.pitch + 12, n.start, n.duration, n.velocity * 0.75);
      add("piccolo", n.pitch + 24, n.start, n.duration, n.velocity * 0.7);
    }
  }

  // 和音: 弦のコラール + 木管/ホルン/テューバ + 金管/ティンパニ
  segments.forEach((seg, i) => {
    const v = voicings[i]!;
    const sec = sectionAt(sections, seg.start);
    const energy = energyOf(sec);
    const g = sec.gain;
    const dur = Math.max(0.25, seg.len - 0.05);

    add("violin2", v[2]!, seg.start, dur, 72 * g);
    add("viola", v[1]!, seg.start, dur, 70 * g);
    add("cello", v[0]!, seg.start, dur, 76 * g);
    add("contrabass", v[0]! - 12, seg.start, dur, 68 * g);

    if (energy >= 2) {
      add("oboe2", v[1]!, seg.start, dur, 60 * g);
      add("clarinet1", v[2]!, seg.start, dur, 62 * g);
      add("clarinet2", v[1]!, seg.start, dur, 58 * g);
      add("bassoon1", v[0]!, seg.start, dur, 64 * g);
      add("bassoon2", v[1]!, seg.start, dur, 58 * g);
      add("horn1", v[1]!, seg.start, dur, 60 * g);
      add("horn2", v[2]!, seg.start, dur, 56 * g);
      add("tuba", v[0]! - 12, seg.start, dur, 60 * g);
      for (let s = 0, k = 0; s < seg.len - 0.05; s += 0.5, k++) {
        add("harp", v[k % v.length]!, seg.start + s, 0.4, 66 * g);
      }
    }

    if (energy >= 3) {
      add("flute2", v[2]! + 12, seg.start, dur, 54 * g);
    }

    // 小節頭の打楽器・金管
    const barStart = Math.ceil(seg.start / beatsPerBar) * beatsPerBar;
    for (let beat = barStart; beat < seg.start + seg.len - 1e-6; beat += beatsPerBar) {
      if (energy >= 2) add("timpani", bassPitch(chordAt(events, beat).bass), beat, 0.5, 96 * g);
      if (energy >= 3) {
        add("trumpet1", v[2]!, beat, 0.5, 88 * g);
        add("trumpet2", v[1]!, beat, 0.5, 82 * g);
        add("trombone1", v[1]!, beat, 0.5, 84 * g);
        add("trombone2", v[0]!, beat, 0.5, 80 * g);
      }
    }
  });

  // 打楽器: 強奏セクションでバスドラム・シンバル、最後の小節にスネアロール
  for (const sec of sections) {
    if (energyOf(sec) < 3) continue;
    const g = sec.gain;
    for (let beat = sec.start; beat < sec.end - 1e-6; beat += beatsPerBar) add("bassdrum", 36, beat, 0.25, 100 * g);
    add("cymbals", 49, sec.start, 1, 100 * g);
    if (!plan.loop && sec.end === totalBeats) add("cymbals", 49, sec.end - beatsPerBar, 1, 95 * g);
    const lastBar = sec.end - beatsPerBar;
    for (let i = 0; i < 4; i++) add("snare", 38, lastBar + beatsPerBar - 1 + i * 0.25, 0.2, 80 + i * 10);
  }

  return ORCHESTRA_PARTS.flatMap((part) => {
    const ns = notes.get(part.id);
    if (!ns || ns.length === 0) return [];
    ns.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return [{ name: part.name, program: part.program, channel: part.channel, notes: ns }];
  });
}
