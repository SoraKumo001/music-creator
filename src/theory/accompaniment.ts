import { gainAt, sectionAt, type EndingStyle, type Section } from "../plan";
import type { Note } from "../score";
import { bassPitch, parseChord, voice, type Chord } from "./harmony";
import { voiceProgression } from "./voicing";
import { mulberry32 } from "../util/random";

export type ChordEvent = { start: number; symbol: string };

export const COMP_STYLES = ["pad", "block", "arpeggio", "offbeat", "strum", "syncopation"] as const;
export const BASS_STYLES = ["root", "rootFifth", "walking", "eighths", "pedal", "none"] as const;

/** 決定的な「人間らしさ」: 位置ごとにベロシティを±揺らす */
const jitter = (i: number) => ((i * 7) % 5) - 2;

type Segment = { start: number; len: number; chord: Chord; next?: Chord; index: number };

/** コードイベントを区間に変換し、cuts(セクション境界など)でも分割する */
export function toSegments(events: ChordEvent[], totalBeats: number, cuts: number[] = []): Segment[] {
  const sorted = [...events].sort((a, b) => a.start - b.start).filter((e) => e.start < totalBeats);
  if (sorted.length === 0) throw new Error("chords is empty");
  const chords = sorted.map((e) => parseChord(e.symbol));
  const starts = sorted.map((e, i) => (i === 0 ? 0 : e.start)); // 先頭は0拍から
  const out: Segment[] = [];
  sorted.forEach((_, i) => {
    const s = starts[i]!;
    const e = starts[i + 1] ?? totalBeats;
    const points = [s, ...cuts.filter((c) => c > s && c < e).sort((a, b) => a - b), e];
    for (let k = 0; k < points.length - 1; k++) {
      const isLastPart = k === points.length - 2;
      out.push({ start: points[k]!, len: points[k + 1]! - points[k]!, chord: chords[i]!, next: isLastPart ? chords[i + 1] : chords[i], index: i });
    }
  });
  return out.filter((s) => s.len > 0);
}

/** 指定拍で鳴っているコード */
export function chordAt(events: ChordEvent[], beat: number): Chord {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  let cur = sorted[0]!;
  for (const e of sorted) if (e.start <= beat) cur = e;
  return parseChord(cur.symbol);
}

function hit(out: Note[], seg: Segment, rel: number, dur: number, pitch: number, vel: number, gain: number) {
  if (rel >= seg.len - 1e-6) return;
  out.push({
    pitch,
    start: seg.start + rel,
    duration: Math.max(0.1, Math.min(dur, seg.len - rel)),
    velocity: Math.max(1, Math.min(127, Math.round(vel * gain))),
  });
}

export type Arrangement = { sections: Section[]; totalBeats: number; beatsPerBar: number; ending?: EndingStyle; loop?: boolean };

const cutsOf = (a: Arrangement) => [...a.sections.map((s) => s.start), a.totalBeats - a.beatsPerBar];
/** 最終小節は「終止」として扱う(ループ用の曲では終止しない) */
const isEnding = (a: Arrangement, beat: number) => !a.loop && a.sections.length > 0 && beat >= a.totalBeats - a.beatsPerBar - 1e-6;

export function generateComp(events: ChordEvent[], a: Arrangement, opts: { seed?: number } = {}): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  const voicings = voiceProgression(sorted.map((e) => parseChord(e.symbol)));
  // seed指定時のみベロシティへ微小な人間味ノイズ (タイミングは変えない=テスト互換)
  const rand = opts.seed !== undefined ? mulberry32((opts.seed ^ 0x9e3779b9) >>> 0) : null;
  const human = () => (rand ? Math.floor(rand() * 7) - 3 : 0);
  let n = 0;
  for (const seg of toSegments(events, a.totalBeats, cutsOf(a))) {
    const sec = sectionAt(a.sections, seg.start);
    // スウェル込みのゲイン。swell=0 なら従来通り sec.gain
    const gg = (rel: number) => gainAt(sec, seg.start + rel);
    const g = gg(0);
    const v = voicings[seg.index] ?? voice(seg.chord, 62);
    const style = isEnding(a, seg.start) ? (a.ending ?? "button") : sec.role === "break" ? "break" : sec.comp;
    switch (style) {
      case "break": // 休止: 頭の小さな一打だけ残す
        for (const p of v) hit(out, seg, 0, Math.min(0.5, seg.len - 0.05), p, 62 + jitter(n), g);
        break;
      case "block": // 1拍目と3拍目裏のスタブ
        for (const p of v) hit(out, seg, 0, 1.5, p, 72 + jitter(n), g);
        for (const p of v) hit(out, seg, 2.5, 1, p, 60 + jitter(n + 1), gg(2.5));
        break;
      case "arpeggio": {
        const seq = v.length > 2 ? [...v, ...v.slice(1, -1).reverse()] : v;
        for (let s = 0, i = 0; s < seg.len; s += 0.5, i++) {
          hit(out, seg, s, 0.75, seq[i % seq.length]!, (s % 1 === 0 ? 72 : 56) + jitter(n + i), gg(s));
        }
        break;
      }
      case "offbeat":
        for (let s = 0.5, i = 0; s < seg.len; s += 1, i++) for (const p of v) hit(out, seg, s, 0.4, p, 70 + jitter(n + i), gg(s));
        break;
      case "syncopation": // 裏拍アクセントのシンコペーション
        for (let s = 0.5, i = 0; s < seg.len; s += 1, i++) {
          const vel = i % 2 === 0 ? 78 : 64;
          for (const p of v) hit(out, seg, s, 0.35, p, vel + jitter(n + i), gg(s));
        }
        if (seg.len >= 3) for (const p of v) hit(out, seg, seg.len - 0.5, 0.4, p, 66 + jitter(n), gg(seg.len - 0.5));
        break;
      case "strum":
        for (let s = 0, i = 0; s < seg.len; s += 1, i++) for (const p of v) hit(out, seg, s, 0.9, p, (s % 2 === 0 ? 78 : 64) + jitter(n + i), gg(s));
        break;
      case "button":
      case "stop":
      case "ring":
      case "hits": {
        // 終止は曲ごとに形を変える
        const len = seg.len;
        if (style === "stop") {
          // 1 回だけ短く鳴らして切る
          for (const p of v) hit(out, seg, 0, Math.min(0.75, len - 0.05), p, 88 + jitter(n), g);
        } else if (style === "ring") {
          // 最後の和音を余韻として伸ばす
          for (const p of v) hit(out, seg, 0, len - 0.05, p, 80 + jitter(n), g);
        } else if (style === "hits") {
          // 4 分音符で刻む
          for (let s = 0, i = 0; s < len - 0.05; s += 1, i++) {
            const vel = i === 0 ? 88 : i === 3 ? 76 : 82;
            for (const p of v) hit(out, seg, s, 0.35, p, vel + jitter(n + i), g);
          }
        } else {
          // button: 1 拍目と中間拍の 2 回
          for (const p of v) hit(out, seg, 0, Math.min(0.9, len - 0.05), p, 84 + jitter(n), g);
          if (len >= 3) {
            const mid = Math.floor(len / 2);
            for (const p of v) hit(out, seg, mid, Math.min(0.9, len - mid - 0.05), p, 76 + jitter(n), g);
          }
        }
        break;
      }
      default: // pad
        for (const p of v) hit(out, seg, 0, seg.len - 0.05, p, 58 + jitter(n), g);
    }
    n++;
  }
  if (rand) for (const note of out) note.velocity = Math.max(1, Math.min(127, note.velocity + human()));
  return out;
}

export function generateBass(events: ChordEvent[], a: Arrangement, opts: { seed?: number } = {}): Note[] {
  const out: Note[] = [];
  const rand = opts.seed !== undefined ? mulberry32((opts.seed ^ 0x85ebca6b) >>> 0) : null;
  const human = () => (rand ? Math.floor(rand() * 7) - 3 : 0);
  let n = 0;
  for (const seg of toSegments(events, a.totalBeats, cutsOf(a))) {
    const sec = sectionAt(a.sections, seg.start);
    if (sec.bass === "none") continue;
    const gg = (rel: number) => gainAt(sec, seg.start + rel);
    const g = gg(0);
    const root = bassPitch(seg.chord.bass);
    const fifth = root + 7;
    const third = root + (seg.chord.tones[0] === (seg.chord.root + 3) % 12 ? 3 : 4);
    const v = (b: number) => b + jitter(n++);
    if (isEnding(a, seg.start)) {
      const len = seg.len;
      const ending = a.ending ?? "button";
      if (ending === "stop") {
        hit(out, seg, 0, Math.min(0.75, len - 0.05), root, v(98), g);
      } else if (ending === "ring") {
        hit(out, seg, 0, len - 0.05, root, v(92), g);
      } else if (ending === "hits") {
        for (let s = 0; s < len - 0.05; s += 1) hit(out, seg, s, 0.3, root, v(s === 0 ? 96 : 82), gg(s));
      } else {
        hit(out, seg, 0, Math.min(0.9, len - 0.05), root, v(95), g);
        if (len >= 3) hit(out, seg, Math.floor(len / 2), 0.5, root, v(80), gg(Math.floor(len / 2)));
      }
      continue;
    }
    if (sec.role === "break") {
      // 休止: ルートのロングトーンだけ
      hit(out, seg, 0, seg.len - 0.05, root, v(80), g);
      continue;
    }
    switch (sec.bass) {
      case "rootFifth":
        hit(out, seg, 0, 1, root, v(92), g);
        hit(out, seg, 1, 1, fifth, v(78), gg(1));
        hit(out, seg, 2, 1, root, v(86), gg(2));
        hit(out, seg, 3, 1, fifth, v(74), gg(3));
        break;
      case "walking":
        for (let b = 0; b < seg.len; b++) {
          const i = b % 4;
          let p = [root, third, fifth, fifth][i]!;
          if (i === 3 || b >= seg.len - 1) {
            // 次のコードのルートへ半音アプローチ
            const target = seg.next ? bassPitch(seg.next.bass) : root;
            p = target + (target > fifth ? -1 : 1);
          }
          hit(out, seg, b, 0.95, p, v(i === 0 ? 92 : 78), gg(b));
        }
        break;
      case "eighths":
        for (let s = 0, i = 0; s < seg.len; s += 0.5, i++) hit(out, seg, s, 0.45, i % 2 ? root + 12 : root, v(s % 1 === 0 ? 92 : 70), gg(s));
        break;
      case "pedal": // 通奏低音: ルートを引き伸ばす
        hit(out, seg, 0, seg.len - 0.05, root, v(86), g);
        break;
      default: // root
        hit(out, seg, 0, 1.75, root, v(95), g);
        hit(out, seg, 2, 1.25, root, v(82), gg(2));
        hit(out, seg, 3.5, 0.5, fifth, v(66), gg(3.5));
    }
  }
  if (rand) for (const note of out) note.velocity = Math.max(1, Math.min(127, note.velocity + human()));
  return out;
}
