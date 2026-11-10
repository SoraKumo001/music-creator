import { GM_DRUMS } from "./index";
import type { Section } from "../plan";
import type { Note } from "../score";

/** 1小節(16分グリッド)のパターン。値は [ステップ(0-15), ドラム名, ベロシティ] */
type Hit = [number, keyof typeof GM_DRUMS, number];

const BAR_PATTERNS: Record<string, Hit[]> = {
  lofi: [
    [0, "kick", 90], [6, "kick", 70], [8, "kick", 80], [4, "snare", 60], [12, "snare", 65],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Hit => [s, "closedHat", i % 2 ? 40 : 55]),
  ],
  rock: [
    [0, "kick", 105], [8, "kick", 100], [4, "snare", 105], [12, "snare", 105],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Hit => [s, "closedHat", i % 2 ? 70 : 90]),
  ],
  fourOnFloor: [
    [0, "kick", 110], [4, "kick", 105], [8, "kick", 110], [12, "kick", 105],
    [4, "snare", 90], [12, "snare", 90],
    ...[2, 6, 10, 14].map((s): Hit => [s, "openHat", 75]),
  ],
  swing: [
    ...[0, 4, 8, 12].map((s): Hit => [s, "ride", 80]),
    ...[6, 14].map((s): Hit => [s, "ride", 60]),
    [4, "snare", 45], [12, "snare", 45], [0, "kick", 50],
  ],
  basic: [
    [0, "kick", 100], [8, "kick", 95], [4, "snare", 100], [12, "snare", 100],
    ...[0, 4, 8, 12].map((s): Hit => [s, "closedHat", 70]),
  ],
};

export const DRUM_PATTERN_NAMES = Object.keys(BAR_PATTERNS);

const vel = (v: number, gain: number) => Math.max(1, Math.min(127, Math.round(v * gain)));

/**
 * セクションごとのパターンからドラムを作る。
 *  - セクション頭にクラッシュ、セクション最終小節にフィル(次のセクションがある場合)
 *  - 曲の最終小節は1拍目のキック+クラッシュだけで締める
 */
export function generateDrums(sections: Section[], beatsPerBar = 4): Note[] {
  const notes: Note[] = [];
  const totalBars = sections.reduce((n, s) => n + s.bars, 0);
  sections.forEach((sec, si) => {
    if (sec.drums === "none") return;
    const pat = BAR_PATTERNS[sec.drums] ?? BAR_PATTERNS.basic!;
    const g = sec.gain;
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.startBar + b;
      const base = bar * beatsPerBar;
      if (bar === totalBars - 1 && totalBars > 1) {
        notes.push({ pitch: GM_DRUMS.kick, start: base, duration: 0.25, velocity: vel(100, g) });
        notes.push({ pitch: GM_DRUMS.crash, start: base, duration: 1, velocity: vel(95, g) });
        continue;
      }
      const isFill = b === sec.bars - 1 && sec.bars >= 2 && si < sections.length - 1;
      for (const [step, drum, v] of pat) {
        const start = base + step / 4;
        if (start >= base + beatsPerBar) continue;
        if (isFill && start >= base + beatsPerBar - 1 && (drum === "kick" || drum === "snare")) continue;
        notes.push({ pitch: GM_DRUMS[drum], start, duration: 0.25, velocity: vel(v, g) });
      }
      if (isFill) {
        for (let i = 0; i < 4; i++) {
          const pitch = i < 2 ? GM_DRUMS.snare : i === 2 ? GM_DRUMS.tomHigh : GM_DRUMS.tomLow;
          notes.push({ pitch, start: base + beatsPerBar - 1 + i * 0.25, duration: 0.25, velocity: vel(70 + i * 10, g) });
        }
      }
      if (b === 0) notes.push({ pitch: GM_DRUMS.crash, start: base, duration: 1, velocity: vel(85, g) });
    }
  });
  return notes;
}
