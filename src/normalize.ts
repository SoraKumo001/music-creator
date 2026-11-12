import type { Score } from "./score";
import { clampToRange } from "./theory";

/**
 * 拍内のサブディビジョンをスウィング比率で線形ワープする (jevthoven の warpTick 方式)。
 * swing=0 なら恒等、swing>0 なら拍前半 [0, 0.5] を [0, mid] へ伸ばし、
 * 拍後半 [0.5, 1.0] を [mid, 1.0] へ圧縮する (mid = 0.5 + swing * 0.5)。
 */
export function warpBeat(beat: number, swing: number): number {
  if (swing <= 0 || beat < 0) return beat;
  const q = Math.floor(beat);
  const u = beat - q;
  const mid = 0.5 + swing * 0.5;
  return u <= 0.5
    ? q + 2 * mid * u
    : q + mid + 2 * (1 - mid) * (u - 0.5);
}

/**
 * 変換前の正規化: 音域補正、長さ・開始位置の丸め、小節はみ出し切り詰め。
 * swing>0 で開始位置と終了位置の両方をワープし、裏拍の重複や表拍の隙間を防ぐ。
 */
export function normalizeScore(score: Score, maxBars = 64, opts: { swing?: number } = {}): Score {
  const beatsPerBar = (score.timeSignature[0] * 4) / score.timeSignature[1];
  const maxBeats = beatsPerBar * maxBars;
  const q = (x: number) => Math.round(x * 16) / 16; // 1/16拍に丸め
  const swing = Math.max(0, Math.min(0.6, opts.swing ?? 0));

  return {
    ...score,
    tracks: score.tracks.map((t) => {
      const isDrum = t.channel === 9;
      const notes = t.notes
        .filter((n) => n.start < maxBeats)
        .map((n) => {
          const rawStart = !isDrum && swing > 0 ? warpBeat(n.start, swing) : n.start;
          const rawEnd = !isDrum && swing > 0 ? warpBeat(n.start + n.duration, swing) : n.start + n.duration;
          const start = q(rawStart);
          const end = Math.min(maxBeats, q(rawEnd));
          const duration = Math.max(1 / 16, end - start);
          return { ...n, start, duration, pitch: clampToRange(n.pitch, t.program, isDrum) };
        });
      return { ...t, notes };
    }).filter((t) => t.notes.length > 0),
  };
}
