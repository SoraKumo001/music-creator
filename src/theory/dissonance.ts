/**
 * 不協和音の検出と解消。
 *
 * 生成側の各声部 (パッド・アルペジオ・シーケンス・コード・ベース・ハモリ・対旋律) は
 * それぞれ局所的に衝突を避けているが、声部をまたぐと短2度/短9度が残ることがある。
 * ここでは全トラックを突き合わせて、
 *   - 旋律は絶対に動かさない
 *   - 優先度の低い声部だけを「別のコードトーンへ移す / 切る / 落とす」で解消する
 * という方針で後処理する。決定的 (乱数なし)。
 */

import type { Note } from "../score";

export type DissonanceTrack = { name: string; channel: number; notes: Note[] };

export type DissonanceHit = {
  /** 衝突が始まる拍 */
  beat: number;
  overlap: number;
  /** 半音差 (1 or 11) */
  interval: number;
  a: { track: string; index: number; pitch: number; start: number; end: number };
  b: { track: string; index: number; pitch: number; start: number; end: number };
};

export type DissonanceFix = {
  track: string;
  index: number;
  action: "repitch" | "trim" | "drop";
  from: number;
  to?: number;
  beat: number;
};

export type DissonanceOptions = {
  /** 衝突とみなす最小重なり (拍) */
  minOverlap?: number;
  /** 短い方の音に対する重なりの割合の下限 (境界のわずかな食い込みを無視) */
  minOverlapRatio?: number;
  /** 反復回数の上限 */
  maxPasses?: number;
  /** 修正回数の上限 */
  maxFixes?: number;
};

/** ピッチクラス間の半音距離 (0-6) */
export function pcDistance(a: number, b: number): number {
  const d = Math.abs(((a % 12) + 12) % 12 - (((b % 12) + 12) % 12));
  return Math.min(d, 12 - d);
}

const isSemitone = (a: number, b: number) => pcDistance(a, b) === 1;

const endOf = (n: Note) => n.start + n.duration;
const overlapOf = (a: Note, b: Note) => Math.min(endOf(a), endOf(b)) - Math.max(a.start, b.start);

/** トラックの優先度 (小さいほど優先)。旋律 0 は動かさない */
export function defaultPriority(name: string): number {
  const n = name.toLowerCase();
  if (n.includes("melody") || n.includes("lead") || n.includes("violin i")) return 0;
  if (n.includes("bass") || n.includes("cello") || n.includes("contrabass")) return 1;
  if (n.includes("chord") || n.includes("comp") || n.includes("piano")) return 2;
  if (n.includes("counter")) return 3;
  if (n.includes("harmony")) return 4;
  if (n.includes("pad")) return 5;
  if (n.includes("seq")) return 6;
  if (n.includes("arp")) return 7;
  return 5;
}

/** 全トラックを突き合わせて短2度/短9度の衝突を列挙する */
export function findDissonances(tracks: DissonanceTrack[], opts: DissonanceOptions = {}): DissonanceHit[] {
  const minOverlap = opts.minOverlap ?? 0.2;
  const ratio = opts.minOverlapRatio ?? 0.35;
  const notes: { track: string; channel: number; index: number; note: Note }[] = [];
  for (const t of tracks) {
    if (t.channel === 9) continue; // ドラムは音程を持たない
    t.notes.forEach((note, index) => notes.push({ track: t.name, channel: t.channel, index, note }));
  }
  notes.sort((a, b) => a.note.start - b.note.start);

  const hits: DissonanceHit[] = [];
  const active: typeof notes = [];
  for (const item of notes) {
    // 終わった音を落とす
    for (let i = active.length - 1; i >= 0; i--) {
      if (endOf(active[i]!.note) <= item.note.start + 1e-6) active.splice(i, 1);
    }
    for (const other of active) {
      if (other.track === item.track) continue;
      if (!isSemitone(other.note.pitch, item.note.pitch)) continue;
      const overlap = overlapOf(other.note, item.note);
      if (overlap < minOverlap) continue;
      if (overlap < ratio * Math.min(other.note.duration, item.note.duration)) continue;
      hits.push({
        beat: Math.max(other.note.start, item.note.start),
        overlap: Math.round(overlap * 1000) / 1000,
        interval: pcDistance(other.note.pitch, item.note.pitch),
        a: { track: other.track, index: other.index, pitch: other.note.pitch, start: other.note.start, end: endOf(other.note) },
        b: { track: item.track, index: item.index, pitch: item.note.pitch, start: item.note.start, end: endOf(item.note) },
      });
    }
    active.push(item);
  }
  return hits;
}

export type ReduceOptions = DissonanceOptions & {
  /** その拍のコード構成音のピッチクラス */
  chordTonesAt: (beat: number) => number[];
  /** その拍のスケール構成音のピッチクラス (任意) */
  scaleTonesAt?: (beat: number) => number[];
  /** トラック名ごとの優先度 (省略時 defaultPriority) */
  priorityOf?: (name: string) => number;
};

export type ReduceResult = { tracks: DissonanceTrack[]; fixes: DissonanceFix[]; remaining: DissonanceHit[] };

/** 衝突を、優先度の低い声部だけを動かして解消する */
export function reduceDissonances(tracks: DissonanceTrack[], opts: ReduceOptions): ReduceResult {
  const priorityOf = opts.priorityOf ?? defaultPriority;
  const maxPasses = opts.maxPasses ?? 6;
  const maxFixes = opts.maxFixes ?? 400;
  // 作業コピー (元の配列は壊さない)
  const work: DissonanceTrack[] = tracks.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) }));
  const fixes: DissonanceFix[] = [];

  const byName = new Map(work.map((t) => [t.name, t]));

  for (let pass = 0; pass < maxPasses; pass++) {
    const hits = findDissonances(work, opts);
    if (hits.length === 0) break;
    let fixedThisPass = 0;

    for (const hit of hits) {
      if (fixes.length >= maxFixes) break;
      const prioA = priorityOf(hit.a.track);
      const prioB = priorityOf(hit.b.track);
      // 優先度が同じなら、長い音を残す
      const victimSide = prioA === prioB
        ? (hit.a.end - hit.a.start >= hit.b.end - hit.b.start ? "b" : "a")
        : prioA > prioB ? "a" : "b";
      const victim = victimSide === "a" ? hit.a : hit.b;
      const keeper = victimSide === "a" ? hit.b : hit.a;
      if (priorityOf(victim.track) === 0) continue; // 旋律は動かさない

      const track = byName.get(victim.track);
      if (!track) continue;
      const note = track.notes[victim.index];
      if (!note) continue;
      // 以前の修正で既に変わっている場合はインデックスが有効とは限らない → 一致確認
      if (note.pitch !== victim.pitch || Math.abs(note.start - victim.start) > 1e-6) continue;
      // keeper の音がまだ鳴っているか確認
      const keeperTrack = byName.get(keeper.track);
      const keeperNote = keeperTrack?.notes[keeper.index];
      if (!keeperNote || keeperNote.pitch !== keeper.pitch) continue;
      if (overlapOf(keeperNote, note) < (opts.minOverlap ?? 0.2)) continue;

      // 1) 別のコードトーン/スケール音へ移す
      const moved = tryRepitch(note, keeperNote, work, opts, priorityOf, victim.track);
      if (moved !== null) {
        fixes.push({ track: victim.track, index: victim.index, action: "repitch", from: note.pitch, to: moved, beat: note.start });
        note.pitch = moved;
        fixedThisPass++;
        continue;
      }
      // 2) 相手より手前で切る
      if (keeperNote.start > note.start + 0.08) {
        const newDur = keeperNote.start - note.start - 0.01;
        if (newDur >= 0.08) {
          fixes.push({ track: victim.track, index: victim.index, action: "trim", from: note.pitch, beat: note.start });
          note.duration = newDur;
          fixedThisPass++;
          continue;
        }
      }
      // 3) 落とす
      fixes.push({ track: victim.track, index: victim.index, action: "drop", from: note.pitch, beat: note.start });
      note.duration = 0;
      note.velocity = 1;
      fixedThisPass++;
    }

    // 落とした音を除去
    for (const t of work) t.notes = t.notes.filter((n) => n.duration > 0);
    // インデックスがずれるので次パスは再検出から
    for (const t of work) byName.set(t.name, t);
    if (fixedThisPass === 0) break;
  }

  const remaining = findDissonances(work, opts);
  return { tracks: work, fixes, remaining };
}

/** 衝突しない代替ピッチを探す。無ければ null */
function tryRepitch(
  note: Note,
  keeper: Note,
  tracks: DissonanceTrack[],
  opts: ReduceOptions,
  priorityOf: (name: string) => number,
  trackName: string,
): number | null {
  const chordTones = opts.chordTonesAt(note.start).map((pc) => ((pc % 12) + 12) % 12);
  const scaleTones = (opts.scaleTonesAt?.(note.start) ?? []).map((pc) => ((pc % 12) + 12) % 12);
  const pcs = [...new Set([...chordTones, ...scaleTones])];
  const myPriority = priorityOf(trackName);
  // 近い順の候補 (オクターブ上下も含む)
  const candidates: number[] = [];
  for (const pc of pcs) {
    for (let shift = -12; shift <= 12; shift += 12) {
      const p = (note.pitch - (((note.pitch % 12) + 12) % 12)) + pc + shift;
      if (p >= 30 && p <= 100) candidates.push(p);
    }
  }
  const ordered = [...new Set(candidates)].sort((a, b) => {
    // ユニゾン/オクターブ重複より、3度・5度などの違う音を優先する
    const dupA = pcDistance(a, keeper.pitch) === 0 ? 1 : 0;
    const dupB = pcDistance(b, keeper.pitch) === 0 ? 1 : 0;
    return dupA - dupB || Math.abs(a - note.pitch) - Math.abs(b - note.pitch);
  });

  for (const pitch of ordered) {
    if (pitch === note.pitch) continue;
    if (isSemitone(pitch, keeper.pitch)) continue; // keeper と半音は不可
    let ok = true;
    for (const t of tracks) {
      if (t.name === trackName) continue;
      for (const other of t.notes) {
        if (other.duration <= 0) continue;
        if (overlapOf(other, { ...note, pitch }) < (opts.minOverlap ?? 0.2)) continue;
        // 自分より優先度が高い音、または同格の音とは半音を避ける
        if (priorityOf(t.name) <= myPriority && isSemitone(pitch, other.pitch)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) return pitch;
  }
  return null;
}
