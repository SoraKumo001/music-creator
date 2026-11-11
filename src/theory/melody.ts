import { keyAtBeat, type Plan, type Section } from "../plan";
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

/**
 * メロディ候補の採点に使う統計的な目標値。
 * 省略時は従来の手調整値、コーパスがある場合はプロファイル由来の値を使う。
 */
export type MelodyTargets = {
  /** 1小節あたり音符数 */
  notesPerBar: number;
  /** 音域 (半音) */
  range: number;
  /** メロディの中央音域 (MIDI) */
  medianPitch: number;
  /** 順次進行 (1-2半音) の割合 */
  stepwiseShare: number;
};

/** 従来の手調整値 (コーパス未生成時のフォールバック) */
export const DEFAULT_MELODY_TARGETS: MelodyTargets = {
  notesPerBar: 5,
  range: 12,
  medianPitch: 72,
  stepwiseShare: 0.55,
};

/** メロディ候補をルールで採点する(0-100)。高いほど「曲として自然」 */
export function scoreMelody(notes: Note[], ctx: MelodyContext, targets: MelodyTargets = DEFAULT_MELODY_TARGETS): MelodyScore {
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
  const medianPitch = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]!;
  // コーパスの melodyRange / melody.medianPitch に合わせて音域・音域中心を評価する
  const range =
    band(span, targets.range * 0.7, targets.range * 1.3, 8) *
    band(medianPitch, targets.medianPitch - 12, targets.medianPitch + 10, 8) *
    band(Math.max(...pitches), targets.medianPitch - 4, targets.medianPitch + 18, 8);

  const durs = new Set(ns.map((n) => Math.round(n.duration * 4)));
  const rhythm = band(durs.size, 3, 6, 2);

  const perBar = ns.length / ctx.bars;
  // コーパスの melodyNotesPerBar を中心に許容幅を持たせる
  const density = band(
    perBar,
    Math.max(1.5, targets.notesPerBar * 0.45),
    targets.notesPerBar * 1.2,
    Math.max(2, targets.notesPerBar * 0.35),
  );

  const ivs = ns.slice(1).map((n, i) => Math.abs(n.pitch - ns[i]!.pitch));
  const steps = ivs.filter((d) => d > 0 && d <= 2).length / ivs.length;
  const bigLeaps = ivs.filter((d) => d > 9).length / ivs.length;
  const extremeLeaps = ivs.filter((d) => d > 14).length / ivs.length;
  const expressiveLeaps = ivs.filter((d) => d >= 5 && d <= 12).length / ivs.length;
  const repeats = ivs.filter((d) => d === 0).length / ivs.length;
  // 適度な跳躍(5-12半音)はフックとして歓迎(0.05-0.25)。極端な跳躍(>14)や過度な跳躍のみ減点
  const leapScore = band(expressiveLeaps, 0.05, 0.25, 0.15) * 0.15;
  const contour = clamp01(
    band(
      steps,
      Math.max(0.2, targets.stepwiseShare - 0.15),
      Math.min(0.9, targets.stepwiseShare + 0.2),
      0.35,
    ) +
      leapScore -
      Math.max(0, bigLeaps - 0.2) * 1.5 -
      extremeLeaps * 2 -
      Math.max(0, repeats - 0.3),
  );

  // フレーズの呼吸(休符): 1拍前後の休みが適度にあるか(全小節ぎっしり詰め込まれた棒演奏は減点)
  let rests = 0;
  for (let i = 0; i < ns.length - 1; i++) {
    const gap = ns[i + 1]!.start - (ns[i]!.start + ns[i]!.duration);
    if (gap >= 0.7) rests++;
  }
  const restRate = rests / Math.max(1, ctx.bars / 2);
  const phrasing = band(restRate, 0.35, 1.6, 0.45);

  // モチーフ: 小節ごとのリズム型 + 音程輪郭(上下方向)の反復度を合わせて評価
  const barRhythm = Array.from({ length: ctx.bars }, (_, b) =>
    ns.filter((n) => Math.floor(n.start / ctx.beatsPerBar) === b).map((n) => Math.round((n.start % ctx.beatsPerBar) * 4)).join(","),
  );
  const barContour = Array.from({ length: ctx.bars }, (_, b) => {
    const inB = ns.filter((n) => Math.floor(n.start / ctx.beatsPerBar) === b);
    if (inB.length < 2) return "";
    return inB.slice(1).map((n, i) => {
      const d = n.pitch - inB[i]!.pitch;
      return d === 0 ? "0" : d > 0 ? (d <= 2 ? "+s" : "+l") : (d >= -2 ? "-s" : "-l");
    }).join(",");
  });
  const filled = barRhythm.filter((r) => r !== "");
  const counts = new Map<string, number>();
  for (const r of filled) counts.set(r, (counts.get(r) ?? 0) + 1);
  const rhythmRepeated = filled.filter((r) => counts.get(r)! > 1).length / Math.max(1, filled.length);
  const cFilled = barContour.filter((c) => c !== "");
  const cCounts = new Map<string, number>();
  for (const c of cFilled) cCounts.set(c, (cCounts.get(c) ?? 0) + 1);
  const contourRepeated = cFilled.length > 0
    ? cFilled.filter((c) => cCounts.get(c)! > 1).length / cFilled.length
    : rhythmRepeated;
  const repeated = rhythmRepeated * 0.65 + contourRepeated * 0.35;
  const motif = band(repeated, 0.25, 0.8, 0.25);

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

/** 指定ピッチに最も近いコードトーン (またはスケール音) へ吸着させる */
function nearestChordOrScalePitch(targetPitch: number, chordTones: number[], scaleSet: Set<number>, preferChordTone: boolean): number {
  const pool = preferChordTone && chordTones.length > 0 ? new Set(chordTones) : scaleSet;
  for (let d = 0; d <= 6; d++) {
    if (pool.has(((targetPitch + d) % 12 + 12) % 12)) return targetPitch + d;
    if (pool.has(((targetPitch - d) % 12 + 12) % 12)) return targetPitch - d;
  }
  return targetPitch;
}

/**
 * モチーフ小節群 (sourceStart..sourceStart+len) を targetStart へ移調・転写する。
 * 強拍は移動先のコードトーンへ、経過音はスケール音へ吸着させることで、
 * リズムと音程輪郭 (フック) を保ったまま新しいコード進行に適合させる。
 */
function transposeMotifBlock(
  sourceNotes: Note[],
  sourceStart: number,
  targetStart: number,
  blockBeats: number,
  ctx: MelodyContext,
  opts: { pitchShift?: number; resolveEndToRoot?: boolean } = {},
): Note[] {
  if (sourceNotes.length === 0) return [];
  const srcChord = chordAt(ctx.chords, sourceStart);
  const dstChord = chordAt(ctx.chords, targetStart);
  // ルート差を半音単位 (-5..+6) で計算し、モチーフ全体の基準シフト量とする
  let rootDiff = ((dstChord.root - srcChord.root + 18) % 12) - 6;
  if (Math.abs(rootDiff) > 5) rootDiff = 0;
  const shift = rootDiff + (opts.pitchShift ?? 0);

  return sourceNotes.map((n, idx) => {
    const rel = n.start - sourceStart;
    const newStart = targetStart + Math.max(0, Math.min(blockBeats - 0.125, rel));
    const inBar = newStart % ctx.beatsPerBar;
    const isStrong = Math.abs(inBar) < 0.05 || Math.abs(inBar - ctx.beatsPerBar / 2) < 0.05 || n.duration >= 1;
    const local = localScale(ctx, newStart);
    const ch = chordAt(ctx.chords, newStart);
    let pitch = nearestChordOrScalePitch(n.pitch + shift, ch.tones, local.set, isStrong);
    if (opts.resolveEndToRoot && idx === sourceNotes.length - 1) {
      // フレーズ末尾は主音またはコードのルート/3度へ着地させる
      pitch = nearestChordOrScalePitch(pitch, [local.root, ch.root], local.set, true);
    }
    return { ...n, pitch, start: newStart };
  });
}

/**
 * 主題 (テーマ) の強化・反復・音域クライマックス形成パス:
 * 1. 同一ロール (verse / chorus) が再登場した際、初回セクションの主題モチーフを再現する
 * 2. セクション内部 (4小節以上) で前半2小節のモチーフが後半で全く反復されていない場合、A -> A' 変奏を形成する
 * 3. アップテンポ/高エネルギー区間で長音ばかりの希薄な小節にモチーフ的なリズム分割を加える
 * 4. Verse (中音域 62-77) と Chorus (高音域 70-86) の音域階層とベロシティ存在感を明確化する
 */
export function developTheme(
  notes: Note[],
  plan: Plan,
  sections: Section[],
  beatsPerBar: number,
  opts: { dense?: boolean } = {},
): Note[] {
  if (notes.length < 2 || sections.length === 0) return notes;
  const totalBars = Math.round(sections.reduce((acc, s) => Math.max(acc, s.startBar + s.bars), 0));
  if (totalBars < 2) return notes;

  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const ctx: MelodyContext = {
    key: plan.key,
    chords: events,
    bars: totalBars,
    beatsPerBar,
    keyChanges: plan.keyChanges,
  };

  let current = [...notes].sort((a, b) => a.start - b.start);
  const blockBars = 2;
  const blockBeats = blockBars * beatsPerBar;

  // ロールごとの初回 2小節モチーフを記録
  const roleMotifs = new Map<string, { start: number; notes: Note[] }>();

  for (const sec of sections) {
    if (sec.role === "break" || sec.role === "outro" || sec.bars < 2) continue;
    const secStart = sec.start;
    const secEnd = sec.end;
    const firstBlockEnd = Math.min(secEnd, secStart + blockBeats);
    let headNotes = current.filter((n) => n.start >= secStart - 1e-4 && n.start < firstBlockEnd - 1e-4);

    // (1) 同一ロール (verse / chorus) の2回目以降なら、初回の主題モチーフを前半2小節に再現
    const saved = roleMotifs.get(sec.role);
    if (saved && (sec.role === "verse" || sec.role === "chorus")) {
      const restOfSong = current.filter((n) => n.start < secStart - 1e-4 || n.start >= firstBlockEnd - 1e-4);
      const reprised = transposeMotifBlock(saved.notes, saved.start, secStart, blockBeats, ctx, {
        pitchShift: sec.role === "chorus" ? 0 : 0,
      });
      current = [...restOfSong, ...reprised].sort((a, b) => a.start - b.start);
      headNotes = reprised;
    } else if (headNotes.length >= 3 && (sec.role === "verse" || sec.role === "chorus" || sec.role === "other")) {
      roleMotifs.set(sec.role, { start: secStart, notes: headNotes });
    }

    // (2) セクション内でのモチーフ反復 (A -> A'): 4小節以上のセクションで後半ブロックが希薄または無関係なら応答フレーズを作る
    if (sec.bars >= 4 && headNotes.length >= 3) {
      const answerStart = secStart + blockBeats;
      const answerEnd = Math.min(secEnd, answerStart + blockBeats);
      const ansNotes = current.filter((n) => n.start >= answerStart - 1e-4 && n.start < answerEnd - 1e-4);
      const headSteps = new Set(headNotes.map((n) => Math.round(((n.start - secStart) % beatsPerBar) * 4)));
      const ansSteps = ansNotes.map((n) => Math.round(((n.start - answerStart) % beatsPerBar) * 4));
      const overlap = ansSteps.filter((s) => headSteps.has(s)).length / Math.max(1, ansSteps.length);

      // 応答側が極端に少ない、またはリズムの共通性が低すぎる場合はモチーフ変奏 (A') を転写
      if (ansNotes.length < Math.max(3, Math.floor(headNotes.length * 0.6)) || overlap < 0.25) {
        const rest = current.filter((n) => n.start < answerStart - 1e-4 || n.start >= answerEnd - 1e-4);
        const varied = transposeMotifBlock(headNotes, secStart, answerStart, blockBeats, ctx, {
          resolveEndToRoot: sec.bars === 4,
        });
        current = [...rest, ...varied].sort((a, b) => a.start - b.start);
      }
    }
  }

  // (3) 推進力の補強: dense 指定時、エネルギー2以上のセクションで長音のみの希薄な小節をモチーフ的に分割
  if (opts.dense !== false) {
    const enriched: Note[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const bStart = bar * beatsPerBar;
      const bEnd = bStart + beatsPerBar;
      const sec = sections.find((s) => bStart >= s.start - 1e-4 && bStart < s.end - 1e-4) ?? sections[sections.length - 1]!;
      const barNotes = current.filter((n) => n.start >= bStart - 1e-4 && n.start < bEnd - 1e-4);
      const isFinalBar = !plan.loop && bar === totalBars - 1;
      const isPhraseTailBar = (bar - sec.startBar + 1) % 4 === 0;
      const energy = sec.gain < 1 ? 1 : sec.gain > 1 ? 3 : 2;

      if (isFinalBar || energy <= 1 || sec.role === "break" || sec.role === "outro" || barNotes.length >= 6) {
        enriched.push(...barNotes);
        continue;
      }

      const nextBarNotes: Note[] = [];
      for (let i = 0; i < barNotes.length; i++) {
        const n = barNotes[i]!;
        const nextStart = barNotes[i + 1]?.start ?? bEnd;
        const avail = Math.min(n.duration, nextStart - n.start);
        const posInBar = n.start - bStart;
        // フレーズ終端小節の後半拍は呼吸として残す
        if (isPhraseTailBar && posInBar >= beatsPerBar - 1.5) {
          nextBarNotes.push(n);
          continue;
        }
        const local = localScale(ctx, n.start);
        const ch = chordAt(ctx.chords, n.start);
        const isFastRock = plan.bpm >= 150;
        if (isFastRock && avail >= 2.0 && nextBarNotes.length + (barNotes.length - i) < 8) {
          // 疾走テンポ (150BPM+) で2拍以上の長音が出た場合: 8分音符のシンコペーション駆け上がりフレーズへ変換
          const p1 = nearestChordOrScalePitch(n.pitch + 2, ch.tones, local.set, false);
          const p2 = nearestChordOrScalePitch(n.pitch + 4, ch.tones, local.set, true);
          const p3 = nearestChordOrScalePitch(n.pitch + (bar % 2 === 0 ? 5 : 2), ch.tones, local.set, false);
          nextBarNotes.push(
            { ...n, duration: 0.5 },
            { pitch: p1, start: n.start + 0.5, duration: 0.5, velocity: Math.max(76, n.velocity - 6) },
            { pitch: p2, start: n.start + 1.0, duration: 0.5, velocity: Math.min(122, n.velocity + 6) },
            { pitch: p3, start: n.start + 1.5, duration: Math.max(0.25, avail - 1.55), velocity: Math.min(118, n.velocity + 2) },
          );
        } else if (avail >= 1.5 && nextBarNotes.length + (barNotes.length - i) < 7) {
          // 疾走テンポでは 8分(0.5)+8分シンコペ(0.5)+8分(0.5)、通常は 付点8分(0.75)+16分(0.25)+8分(0.5)
          const stepUp = nearestChordOrScalePitch(n.pitch + 2, ch.tones, local.set, false);
          const target = nearestChordOrScalePitch(n.pitch + (bar % 2 === 0 ? 3 : -2), ch.tones, local.set, true);
          if (isFastRock) {
            nextBarNotes.push(
              { ...n, duration: 0.5 },
              { pitch: target, start: n.start + 0.5, duration: 0.5, velocity: Math.min(122, n.velocity + 6) },
              { pitch: stepUp, start: n.start + 1.0, duration: Math.max(0.25, avail - 1.05), velocity: Math.max(76, n.velocity - 4) },
            );
          } else {
            nextBarNotes.push(
              { ...n, duration: 0.75 },
              { pitch: stepUp, start: n.start + 0.75, duration: 0.25, velocity: Math.max(70, n.velocity - 10) },
              { pitch: target, start: n.start + 1.0, duration: Math.max(0.25, avail - 1.05), velocity: Math.min(120, n.velocity + 4) },
            );
          }
        } else if (avail >= 1.0 && nextBarNotes.length + (barNotes.length - i) < 6) {
          // 8分 (0.5) + 8分 (0.5) のスケール順次・コードトーン分割
          const pass = nearestChordOrScalePitch(n.pitch + (i % 2 === 0 ? 2 : -2), ch.tones, local.set, false);
          nextBarNotes.push(
            { ...n, duration: 0.5 },
            { pitch: pass, start: n.start + 0.5, duration: Math.max(0.25, avail - 0.55), velocity: Math.max(72, n.velocity - 8) },
          );
        } else {
          nextBarNotes.push(n);
        }
      }
      enriched.push(...nextBarNotes);
    }
    current = enriched;
  }

  // (4) セクション役割ごとの音域階層化 (Verse: 62..77 / Chorus & Climax: 69..86) と主旋律の存在感強化
  const shaped = current.map((n) => {
    const sec = sections.find((s) => n.start >= s.start - 1e-4 && n.start < s.end - 1e-4) ?? sections[sections.length - 1]!;
    const isClimax = sec.role === "chorus" || sec.role === "solo" || sec.gain > 1;
    let pitch = n.pitch;
    if (isClimax) {
      while (pitch < 68) pitch += 12;
      while (pitch > 88) pitch -= 12;
    } else {
      while (pitch < 60) pitch += 12;
      while (pitch > 79) pitch -= 12;
    }
    const boost = isClimax ? 12 : 6;
    return { ...n, pitch, velocity: Math.max(72, Math.min(124, (n.velocity ?? 90) + boost)) };
  });

  return polishMelody(shaped, ctx);
}
