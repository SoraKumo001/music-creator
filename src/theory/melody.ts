import { keyAtBeat } from "../plan";
import type { Note } from "../score";
import { chordAt, type ChordEvent } from "./accompaniment";
import { parseKey, SCALES, snapToScale } from "./index";

export type MelodyContext = {
  key: string;
  chords: ChordEvent[];
  bars: number;
  beatsPerBar: number;
  /** 曲中の転調。barは0始まり。その小節から新調で採点・補正する */
  keyChanges?: { bar: number; key: string }[];
};

/** 指定拍で有効な調のスケール集合と主音 */
function localScale(ctx: MelodyContext, start: number): { set: Set<number>; root: number; key: string } {
  const key = keyAtBeat({ key: ctx.key, keyChanges: ctx.keyChanges ?? [] }, start, ctx.beatsPerBar);
  const { root, scale } = parseKey(key);
  return { set: new Set(SCALES[scale]!.map((i) => (i + root) % 12)), root, key };
}

export type MelodyScore = { total: number; parts: Record<string, number> };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** lo〜hi の範囲内なら1、外れるほど0へ */
const band = (x: number, lo: number, hi: number, slack: number) =>
  x < lo ? clamp01(1 - (lo - x) / slack) : x > hi ? clamp01(1 - (x - hi) / slack) : 1;

/** メロディ候補をルールで採点する(0-100)。高いほど「曲として自然」 */
export function scoreMelody(notes: Note[], ctx: MelodyContext): MelodyScore {
  const total = ctx.bars * ctx.beatsPerBar;
  const ns = [...notes].filter((n) => n.start < total).sort((a, b) => a.start - b.start);
  if (ns.length < 2) return { total: 0, parts: {} };

  const inLocalScale = (n: Note) => localScale(ctx, n.start).set.has(n.pitch % 12);
  const isChordTone = (n: Note) => chordAt(ctx.chords, n.start).tones.includes(n.pitch % 12);

  // 強拍(小節頭と中間拍)または長い音がコードトーンか
  const strong = ns.filter((n) => {
    const inBar = n.start % ctx.beatsPerBar;
    return Math.abs(inBar) < 0.01 || Math.abs(inBar - ctx.beatsPerBar / 2) < 0.01 || n.duration >= 1.5;
  });
  const chordTone = strong.length ? strong.filter(isChordTone).length / strong.length : 0.5;

  const inScale = ns.filter((n) => inLocalScale(n) || isChordTone(n)).length / ns.length;

  const pitches = ns.map((n) => n.pitch);
  const span = Math.max(...pitches) - Math.min(...pitches);
  const range = band(span, 7, 17, 8) * band(Math.min(...pitches), 55, 80, 8) * band(Math.max(...pitches), 64, 91, 8);

  const durs = new Set(ns.map((n) => Math.round(n.duration * 4)));
  const rhythm = band(durs.size, 3, 6, 2);

  const perBar = ns.length / ctx.bars;
  // 1小節あたり1.5〜8.5音を好ましい範囲とし、ゆったりした歌メロや休符も許容する
  const density = band(perBar, 1.5, 8.5, 2.5);

  const ivs = ns.slice(1).map((n, i) => Math.abs(n.pitch - ns[i]!.pitch));
  const steps = ivs.filter((d) => d > 0 && d <= 2).length / ivs.length;
  const bigLeaps = ivs.filter((d) => d > 9).length / ivs.length;
  const extremeLeaps = ivs.filter((d) => d > 14).length / ivs.length;
  const expressiveLeaps = ivs.filter((d) => d >= 5 && d <= 12).length / ivs.length;
  const repeats = ivs.filter((d) => d === 0).length / ivs.length;
  // 適度な跳躍(5-12半音)はフックとして歓迎(0.05-0.25)。極端な跳躍(>14)や過度な跳躍のみ減点
  const leapScore = band(expressiveLeaps, 0.05, 0.25, 0.15) * 0.15;
  const contour = clamp01(
    band(steps, 0.35, 0.8, 0.35) + leapScore - Math.max(0, bigLeaps - 0.2) * 1.5 - extremeLeaps * 2 - Math.max(0, repeats - 0.3),
  );

  // フレーズの呼吸(休符): 1拍前後の休みが適度にあるか(全小節ぎっしり詰め込まれた棒演奏は減点)
  let rests = 0;
  for (let i = 0; i < ns.length - 1; i++) {
    const gap = ns[i + 1]!.start - (ns[i]!.start + ns[i]!.duration);
    if (gap >= 0.7) rests++;
  }
  const restRate = rests / Math.max(1, ctx.bars / 2);
  const phrasing = band(restRate, 0.35, 1.6, 0.45);

  // モチーフ: 同じリズム型の小節がどれだけあるか(全く無い/全部同じ はどちらも減点)
  const barRhythm = Array.from({ length: ctx.bars }, (_, b) =>
    ns.filter((n) => Math.floor(n.start / ctx.beatsPerBar) === b).map((n) => Math.round((n.start % ctx.beatsPerBar) * 4)).join(","),
  );
  const filled = barRhythm.filter((r) => r !== "");
  const counts = new Map<string, number>();
  for (const r of filled) counts.set(r, (counts.get(r) ?? 0) + 1);
  const repeated = filled.filter((r) => counts.get(r)! > 1).length / Math.max(1, filled.length);
  const motif = band(repeated, 0.25, 0.75, 0.25);

  // 空白小節があってもフレーズの休止として許容(0.55〜1.0)
  const coverage = band(filled.length / ctx.bars, 0.55, 1, 0.35);

  const last = ns[ns.length - 1]!;
  const lastChord = chordAt(ctx.chords, last.start);
  const lastRoot = localScale(ctx, last.start).root;
  const ending = (lastChord.tones.includes(last.pitch % 12) ? 0.6 : 0) + (last.pitch % 12 === lastRoot ? 0.25 : 0) + (last.duration >= 1 ? 0.15 : 0);

  const parts = { chordTone, inScale, range, rhythm, density, contour, motif, coverage, ending, phrasing };
  const weights: Record<keyof typeof parts, number> = {
    chordTone: 20, inScale: 13, range: 8, rhythm: 11, density: 8, contour: 12, motif: 9, coverage: 5, ending: 7, phrasing: 7,
  };
  let sum = 0;
  for (const k of Object.keys(parts) as (keyof typeof parts)[]) sum += parts[k] * weights[k];
  return { total: Math.round(sum * 10) / 10, parts };
}

/** 採用したメロディの仕上げ: 単旋律化、調外音の補正、音域補正 */
export function polishMelody(notes: Note[], ctx: MelodyContext): Note[] {
  const total = ctx.bars * ctx.beatsPerBar;

  // 同時発音は最高音だけ残す
  const byStart = new Map<number, Note>();
  for (const n of notes) {
    if (n.start >= total) continue;
    const k = Math.round(n.start * 16);
    const cur = byStart.get(k);
    if (!cur || n.pitch > cur.pitch) byStart.set(k, n);
  }
  const ns = [...byStart.values()].sort((a, b) => a.start - b.start);

  const lastIndex = ns.length - 1;
  return ns.map((n, i) => {
    let pitch = n.pitch;
    while (pitch < 55) pitch += 12;
    while (pitch > 96) pitch -= 12;
    // 調にもコードにも属さない「長めの音」だけ補正(短い経過音は残す)。転調区間はその区間の調で判定
    const local = localScale(ctx, n.start);
    const chord = chordAt(ctx.chords, n.start);
    if (n.duration >= 0.5 && !local.set.has(pitch % 12) && !chord.tones.includes(pitch % 12)) {
      pitch = snapToScale(pitch, local.key);
    }
    const next = ns[i + 1];
    const maxDur = next ? next.start - n.start : total - n.start;
    // 最後の音は伸ばし切らず、余韻を残して終わる
    const cap = i === lastIndex ? Math.min(maxDur, ctx.beatsPerBar / 2) : maxDur;

    // ベロシティの抑揚付け: 強拍・高音域を適度に立たせ、機械的な平坦さを解消
    const baseVel = n.velocity ?? 85;
    const inBar = n.start % ctx.beatsPerBar;
    const isDownbeat = Math.abs(inBar) < 0.05;
    const isMidbeat = Math.abs(inBar - ctx.beatsPerBar / 2) < 0.05;
    let velMod = isDownbeat ? 6 : isMidbeat ? 3 : 0;
    const pitchRel = (pitch - 60) / 24; // 60(C4)〜84(C6) 付近での相対高低
    velMod += Math.round(Math.max(-4, Math.min(8, pitchRel * 8)));
    const velocity = Math.max(40, Math.min(125, baseVel + velMod));

    return { ...n, pitch, duration: Math.max(0.0625, Math.min(n.duration, cap)), velocity };
  });
}
