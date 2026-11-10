import type { Score } from "./score";
import { clampToRange } from "./theory";

/** 変換前の正規化: 音域補正、長さ・開始位置の丸め、小節はみ出し切り詰め */
export function normalizeScore(score: Score, maxBars = 64): Score {
  const beatsPerBar = (score.timeSignature[0] * 4) / score.timeSignature[1];
  const maxBeats = beatsPerBar * maxBars;
  const q = (x: number) => Math.round(x * 16) / 16; // 1/16拍に丸め

  return {
    ...score,
    tracks: score.tracks.map((t) => {
      const isDrum = t.channel === 9;
      const notes = t.notes
        .filter((n) => n.start < maxBeats)
        .map((n) => {
          const start = q(n.start);
          const duration = Math.max(1 / 16, Math.min(q(n.duration), maxBeats - start));
          return { ...n, start, duration, pitch: clampToRange(n.pitch, t.program, isDrum) };
        });
      return { ...t, notes };
    }).filter((t) => t.notes.length > 0),
  };
}
