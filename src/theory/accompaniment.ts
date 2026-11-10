import { gainAt, sectionAt, type EndingStyle, type Section } from "../plan";
import type { Note } from "../score";
import { bassPitch, parseChord, voice, type Chord } from "./harmony";
import { voiceProgression } from "./voicing";
import { mulberry32 } from "../util/random";

export type ChordEvent = { start: number; symbol: string };

export const COMP_STYLES = ["pad", "block", "chug", "arpeggio", "arpeggio16", "offbeat", "strum", "syncopation"] as const;
export const BASS_STYLES = ["root", "rootFifth", "walking", "eighths", "sixteenths", "pedal", "none"] as const;

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

function hit(out: Note[], seg: Segment, rel: number, dur: number, pitch: number, vel: number, gain: number, skip = false) {
  if (skip || rel >= seg.len - 1e-6) return;
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

export function generateComp(events: ChordEvent[], a: Arrangement, opts: { seed?: number; melody?: Note[] } = {}): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  const voicings = voiceProgression(sorted.map((e) => parseChord(e.symbol)));
  // seed指定時のみベロシティへ人間味ノイズ (タイミングは変えない=テスト互換)
  const rand = opts.seed !== undefined ? mulberry32((opts.seed ^ 0x9e3779b9) >>> 0) : null;
  const human = () => (rand ? Math.floor(rand() * 11) - 5 : 0);
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
      case "chug": { // 疾走ロック用: 8分ブリッジミュート刻み + 2拍目裏シンコペーションアクセント + 小節末16分ギャロップ
        const rootPc = seg.chord.root;
        const fifthPc = (rootPc + 7) % 12;
        let lowRoot = 48 + rootPc;
        if (lowRoot < 48) lowRoot += 12;
        const powerVoicing = [lowRoot, lowRoot + 7, lowRoot + 12];
        const fullVoicing = v.map((p) => (p > 68 ? p - 12 : p));
        void fifthPc;
        for (let barBase = 0; barBase < seg.len - 1e-6; barBase += a.beatsPerBar) {
          const barLen = Math.min(a.beatsPerBar, seg.len - barBase);
          for (let s = 0, i = 0; s < barLen - 0.05; s += 0.5, i++) {
            const rel = barBase + s;
            const isAccent = Math.abs(s) < 0.01 || Math.abs(s - 1.5) < 0.01 || Math.abs(s - 3.0) < 0.01;
            const chordsToHit = isAccent ? fullVoicing : powerVoicing;
            const dur = isAccent ? 0.42 : 0.22;
            const baseV = Math.abs(s) < 0.01 ? 86 : Math.abs(s - 1.5) < 0.01 ? 84 : Math.abs(s - 3.0) < 0.01 ? 80 : 62;
            for (const p of chordsToHit) hit(out, seg, rel, dur, p, baseV + jitter(n + i), gg(rel));
            // 2拍目裏と4拍目裏に16分のギャロップ刻みを挟んで疾走感を出す
            if ((Math.abs(s - 1.5) < 0.01 || Math.abs(s - 3.5) < 0.01) && s + 0.25 < barLen - 0.05) {
              for (const p of powerVoicing) hit(out, seg, rel + 0.25, 0.2, p, 70 + jitter(n + i + 3), gg(rel + 0.25));
            }
          }
        }
        break;
      }
      case "arpeggio": {
        const seq = v.length > 2 ? [...v, ...v.slice(1, -1).reverse()] : v;
        for (let s = 0, i = 0; s < seg.len; s += 0.5, i++) {
          hit(out, seg, s, 0.75, seq[i % seq.length]!, (s % 1 === 0 ? 72 : 56) + jitter(n + i), gg(s));
        }
        break;
      }
      case "arpeggio16": { // 16分高速アルペジオ (ゲーム/FM音源風の煌びやかなシーケンス)
        const top = v[v.length - 1]! + 12;
        const seq = [...v, top, ...v.slice(1).reverse()];
        for (let s = 0, i = 0; s < seg.len; s += 0.25, i++) {
          const isBeat = s % 1 === 0;
          const is8th = (s * 2) % 1 === 0;
          const baseV = isBeat ? 76 : is8th ? 64 : 54;
          hit(out, seg, s, 0.35, seq[i % seq.length]!, baseV + jitter(n + i), gg(s));
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
        if (rand && seg.next && seg.len >= 4) {
          const target = bassPitch(seg.next.bass);
          const approach = target > fifth ? target - 1 : target + 1;
          hit(out, seg, 3, 0.5, fifth, v(74), gg(3));
          hit(out, seg, 3.5, 0.5, approach, v(80), gg(3.5));
        } else {
          hit(out, seg, 3, 1, fifth, v(74), gg(3));
        }
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
        for (let s = 0, i = 0; s < seg.len; s += 0.5, i++) {
          const stepInBar = i % 8;
          // 疾走感のある8分ロックベース: ルート連打を軸に、2拍目裏(step 3)と4拍目(step 6-7)で5度・オクターブ・アプローチへ動く
          let p = root;
          if (stepInBar === 3) p = root + 12;
          else if (stepInBar === 6) p = fifth <= 58 ? fifth : root;
          else if (stepInBar === 7 && seg.next) {
            const target = bassPitch(seg.next.bass);
            p = target > root ? target - 1 : target + 1;
          }
          const isAccent = stepInBar === 0 || stepInBar === 3 || stepInBar === 4;
          hit(out, seg, s, 0.42, p, v(isAccent ? 94 : 76), gg(s));
          // 小節末尾 (step 7) に16分のピックアップを入れて次小節頭へ突っ込む推進力を作る
          if (rand && stepInBar === 7 && s + 0.25 < seg.len - 0.05) {
            hit(out, seg, s + 0.25, 0.2, root, v(82), gg(s + 0.25));
          }
        }
        break;
      case "sixteenths": // 16分音符の疾走スラップ/シンセベース (Ys II / 80s ゲームロック)
        for (let s = 0, i = 0; s < seg.len; s += 0.25, i++) {
          const stepInBeat = i % 4;
          const isOctave = (i % 8 === 6 || i % 8 === 7 || (stepInBeat === 2 && i % 2 === 0));
          let p = isOctave ? root + 12 : root;
          if (seg.next && s >= seg.len - 0.5) {
            const target = bassPitch(seg.next.bass);
            p = target > root ? target - 1 : target + 1;
          }
          const baseV = stepInBeat === 0 ? 96 : stepInBeat === 2 ? 80 : 54;
          hit(out, seg, s, 0.22, p, v(baseV), gg(s));
        }
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

  // モノフォニック保証: ベースラインの同拍重複を解消し、次ノートの頭と重ならないようトリム
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const monophonic: Note[] = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    const next = out[i + 1];
    // 同一拍（または極小差）で複数の音がある場合、後続を優先（重複排除）
    if (next && Math.abs(next.start - cur.start) < 0.02) continue;
    const maxDur = next ? Math.max(0.05, next.start - cur.start - 0.03) : cur.duration;
    monophonic.push({
      ...cur,
      duration: Math.min(cur.duration, maxDur),
    });
  }
  return monophonic;
}
