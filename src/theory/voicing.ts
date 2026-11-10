/**
 * 進行単位のボイシング。
 * 各和音の候補(転回形 + drop-2)を列挙し、動的計画法で
 * 「声部の移動が少ない・並行5度/8度がない・間隔が開きすぎない」経路を選ぶ。
 */

import { voice, type Chord } from "./harmony";

const LO = 53; // F3
const HI = 79; // G5

function pitchOfPc(pc: number, lo: number): number {
  return lo + ((((pc - lo) % 12) + 12) % 12);
}

/** ベース音を決め、残りの構成音をその上へ近接配置で積む */
function buildStack(pcs: number[], bassPc: number, lo: number, hi: number): number[] | null {
  const pool = [...pcs];
  const bassIdx = pool.indexOf(bassPc);
  if (bassIdx < 0) return null;
  pool.splice(bassIdx, 1);

  const voices = [pitchOfPc(bassPc, lo)];
  let cur = voices[0]!;
  while (pool.length > 0) {
    let best = -1;
    let bestD = 13;
    for (let i = 0; i < pool.length; i++) {
      const d = ((((pool[i]! - cur) % 12) + 12) % 12) || 12;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cur += bestD;
    if (cur > hi) return null;
    voices.push(cur);
    pool.splice(best, 1);
  }
  return voices;
}

/** 上から2番目の声部をオクターブ下げる (drop-2) */
function drop2(voices: number[], lo: number): number[] | null {
  if (voices.length < 3) return null;
  const out = [...voices];
  const i = out.length - 2;
  const lowered = out[i]! - 12;
  if (lowered < lo || lowered <= out[i - 1]!) return null;
  out[i] = lowered;
  return out;
}

/** 1 和音の候補ボイシング (転回形 × drop-2) */
export function voicingsFor(chord: Chord, lo = LO, hi = HI): number[][] {
  const pcs = [...new Set(chord.tones)];
  const out: number[][] = [];
  const seen = new Set<string>();
  const add = (v: number[] | null) => {
    if (!v || v.some((p) => p < lo || p > hi)) return;
    const key = v.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  for (const bassPc of pcs) {
    const stack = buildStack(pcs, bassPc, lo, hi);
    add(stack);
    if (stack) add(drop2(stack, lo));
  }
  return out;
}

/** 声部数が同じなら同順で、違うなら 1 声だけ読み替えて対応づける */
function matchCost(a: number[], b: number[]): number {
  if (a.length === b.length) return a.reduce((sum, p, i) => sum + Math.abs(p - b[i]!), 0);
  const [small, large] = a.length < b.length ? [a, b] : [b, a];
  if (large.length - small.length !== 1) return 1000;
  let best = Infinity;
  for (let skip = 0; skip < large.length; skip++) {
    const rest = large.filter((_, i) => i !== skip);
    const cost = small.reduce((sum, p, i) => sum + Math.abs(p - rest[i]!), 0);
    best = Math.min(best, cost);
  }
  return best + 6; // 声部数が変わる分のペナルティ
}

function isParallel(prev: number[], cur: number[]): { kind: "5th" | "8ve" } | null {
  for (let i = 0; i < prev.length; i++) {
    for (let j = i + 1; j < prev.length; j++) {
      const ip = Math.abs(prev[j]! - prev[i]!) % 12;
      const ic = Math.abs(cur[j]! - cur[i]!) % 12;
      const kind = ip === 7 && ic === 7 ? "5th" : ip === 0 && ic === 0 ? "8ve" : null;
      if (!kind) continue;
      const d1 = cur[i]! - prev[i]!;
      const d2 = cur[j]! - prev[j]!;
      if (d1 === 0 || d2 === 0) continue;
      if (Math.sign(d1) === Math.sign(d2)) return { kind };
    }
  }
  return null;
}

function parallelPenalty(prev: number[], cur: number[]): number {
  return isParallel(prev, cur) ? 100 : 0;
}

function spacingPenalty(v: number[]): number {
  let penalty = 0;
  for (let i = 1; i < v.length; i++) if (v[i]! - v[i - 1]! > 12) penalty += 4;
  return penalty;
}

/** 半音・全音で重なる密集した声部は響きが濁るので避ける (特に短2度は激しく濁るため重いペナルティ) */
function clusterPenalty(v: number[]): number {
  let penalty = 0;
  for (let i = 1; i < v.length; i++) {
    const diff = v[i]! - v[i - 1]!;
    if (diff === 1) penalty += 80;
    else if (diff === 2) penalty += 4;
  }
  return penalty;
}

/** 和音が意図するベース音 (分数コードの分母) から外れる場合のペナルティ */
function bassPenalty(v: number[], chord: Chord): number {
  return v[0]! % 12 === chord.bass ? 0 : 8;
}

/** 進行全体のボイシング。戻り値は chords と同じ長さで、各要素は昇順の MIDI ノート */
export function voiceProgression(chords: Chord[], lo = LO, hi = HI): number[][] {
  if (chords.length === 0) return [];
  const cands = chords.map((c) => {
    const vs = voicingsFor(c, lo, hi);
    return vs.length > 0 ? vs : [voice(c, 62)];
  });

  const n = chords.length;
  const cost = cands.map((cs) => cs.map(() => Infinity));
  const back = cands.map((cs) => cs.map(() => -1));

  for (let j = 0; j < cands[0]!.length; j++)
    cost[0]![j] = spacingPenalty(cands[0]![j]!) + clusterPenalty(cands[0]![j]!) + bassPenalty(cands[0]![j]!, chords[0]!);

  for (let i = 1; i < n; i++) {
    for (let j = 0; j < cands[i]!.length; j++) {
      const cur = cands[i]![j]!;
      for (let k = 0; k < cands[i - 1]!.length; k++) {
        const prev = cands[i - 1]![k]!;
        const total =
          cost[i - 1]![k]! + matchCost(prev, cur) + parallelPenalty(prev, cur) +
          spacingPenalty(cur) + clusterPenalty(cur) + bassPenalty(cur, chords[i]!);
        if (total < cost[i]![j]!) {
          cost[i]![j] = total;
          back[i]![j] = k;
        }
      }
    }
  }

  let best = 0;
  for (let j = 1; j < cands[n - 1]!.length; j++) if (cost[n - 1]![j]! < cost[n - 1]![best]!) best = j;

  const out: number[][] = new Array(n);
  let idx = best;
  out[n - 1] = cands[n - 1]![idx]!;
  for (let i = n - 1; i > 0; i--) {
    idx = back[i]![idx]!;
    out[i - 1] = cands[i - 1]![idx]!;
  }
  return out;
}

/** テスト・デバッグ用: 連続するボイシング間の並行 5 度 / 8 度を列挙する */
export function findParallels(voicings: number[][]): { from: number; to: number; kind: "5th" | "8ve" }[] {
  const out: { from: number; to: number; kind: "5th" | "8ve" }[] = [];
  for (let i = 1; i < voicings.length; i++) {
    const a = voicings[i - 1]!;
    const b = voicings[i]!;
    if (a.length !== b.length) continue;
    const hit = isParallel(a, b);
    if (hit) out.push({ from: i - 1, to: i, kind: hit.kind });
  }
  return out;
}
