import type { Score } from "./score";
import { clampToRange } from "./theory";

/**
 * 変換前の正規化: 音域補正、長さ・開始位置の丸め、小節はみ出し切り詰め。
 * swing>0 で裏拍の8分音符を遅らせる (ドラム以外)。拍の後付けなので生成の破綻を招かない。
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
          // 裏拍8分 (拍位置が0.5で割り切れず1で割り切れない) を遅らせる
          const shifted = !isDrum && swing > 0 && Math.abs(n.start % 1 - 0.5) < 0.01
            ? n.start + swing * 0.5
            : n.start;
          const start = q(shifted);
          const duration = Math.max(1 / 16, Math.min(q(n.duration), maxBeats - start));
          return { ...n, start, duration, pitch: clampToRange(n.pitch, t.program, isDrum) };
        });
      return { ...t, notes };
    }).filter((t) => t.notes.length > 0),
  };
}
