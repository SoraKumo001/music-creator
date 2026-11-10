/**
 * コーパスのMIDIから「実際に使われている1小節ドラムパターン」を抽出する。
 * 集計結果は src/knowledge/drum-patterns.generated.ts に書き出し、生成側の
 * パターン辞書へ追加する（旋律は保存しない）。
 */

import type { ParsedMidi } from "../midi/parseMidi";
import { inferBarTicks } from "./features";

/** 1ステップ = [16分ステップ(0-15), GMドラム名, 強さ(0-127)] */
export type DrumPatternStep = [number, string, number];

const GM_DRUM_NAME: Record<number, string> = {
  35: "acousticBassDrum", 36: "bassDrum", 37: "sideStick", 38: "snare", 39: "handClap",
  40: "electricSnare", 41: "lowFloorTom", 42: "closedHat", 43: "highFloorTom", 44: "pedalHat",
  45: "lowTom", 46: "openHat", 47: "lowMidTom", 48: "hiMidTom", 49: "crash", 50: "highTom",
  51: "ride", 52: "chineseCymbal", 53: "rideBell", 54: "tambourine", 55: "splash", 57: "crash2",
};

const STEP_NAMES = new Set(Object.values(GM_DRUM_NAME));

export type DrumPatternCandidate = {
  /** クラスタ用の正規化キー */
  key: string;
  /** 出現小節数 */
  bars: number;
  /** 代表的なステップ列 (強さは中央値) */
  steps: DrumPatternStep[];
};

/** 1曲から4/4の1小節ドラムパターンを取り出す */
export function extractDrumBarPatterns(midi: ParsedMidi, beatsPerBar = 4): { key: string; steps: DrumPatternStep[] }[] {
  const drums = midi.tracks.flatMap((t) => t.notes).filter((n) => n.channel === 9);
  if (drums.length === 0) return [];
  const div = midi.division;
  // 拍節は他パートも含めて推定する
  const allTicks = midi.tracks.flatMap((t) => t.notes).map((n) => n.tick);
  const { barTicks, source } = inferBarTicks(allTicks, div, beatsPerBar);
  // 4/4相当 (16分=4ステップ) として扱えるものだけ
  const stepsPerBar = Math.round(beatsPerBar * 4);
  if (stepsPerBar !== 16) return [];
  const start = Math.min(...allTicks);
  const bars = Math.max(1, Math.ceil((Math.max(...allTicks) - start) / barTicks));
  const out: { key: string; steps: DrumPatternStep[] }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = start + bar * barTicks;
    const to = from + barTicks;
    const hits = drums.filter((n) => n.tick >= from && n.tick < to);
    if (hits.length < 2) continue;
    // ステップごとに音名 -> 最大ベロシティ
    const byStep = new Map<string, number>();
    for (const n of hits) {
      const name = GM_DRUM_NAME[n.pitch];
      if (!name || !STEP_NAMES.has(name)) continue;
      const rel = (n.tick - from) / barTicks;
      const step = Math.round(rel * 16) % 16;
      const k = `${step}:${name}`;
      byStep.set(k, Math.max(byStep.get(k) ?? 0, n.velocity));
    }
    if (byStep.size < 2) continue;
    const entries = [...byStep.entries()].sort((a, b) => {
      const [as, an] = a[0].split(":");
      const [bs, bn] = b[0].split(":");
      return Number(as) - Number(bs) || (an ?? "").localeCompare(bn ?? "");
    });
    const steps: DrumPatternStep[] = entries.map(([k, vel]) => {
      const [s, name] = k.split(":");
      return [Number(s), name!, vel];
    });
    out.push({ key: steps.map(([s, name]) => `${s}:${name}`).join(";"), steps });
  }
  // 推定根拠を戻り値に含めたい場合のフック (現状は未使用)
  void source;
  return out;
}

/** 全曲のパターンを頻度順に集計する */
export function aggregateDrumPatterns(
  perFile: { key: string; steps: DrumPatternStep[] }[][], limit = 8, minBars = 8,
): DrumPatternCandidate[] {
  const counts = new Map<string, { bars: number; steps: DrumPatternStep[] }>();
  for (const file of perFile) {
    for (const p of file) {
      const cur = counts.get(p.key);
      if (cur) cur.bars += 1;
      else counts.set(p.key, { bars: 1, steps: p.steps });
    }
  }
  return [...counts.entries()]
    .filter(([, v]) => v.bars >= minBars)
    .sort((a, b) => b[1].bars - a[1].bars)
    .slice(0, limit)
    .map(([key, v]) => ({ key, bars: v.bars, steps: v.steps }));
}
