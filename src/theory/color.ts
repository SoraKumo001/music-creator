/**
 * 和声の色付け: 参照MIDIに見られる「借用和音・二次ドミナント・sus4」を
 * ダイアトニック中心の生成進行へ少量混ぜる。決定的 (seed) で、破綻したら元に戻す。
 */

import type { Plan } from "../plan";
import { parseChord } from "./harmony";
import { degreeChord, degreePc, pcName, parseKeyName, type KeyContext } from "./key";
import { analyzeChord } from "./roman";
import { validatePlan } from "./validate";
import { mulberry32 } from "../util/random";

export type ColorOptions = {
  /** 全体の強さ 0-1 (0で無効) */
  strength?: number;
  maxChanges?: number;
  /**
   * sus4 化する確率 (0-1)。省略時 0.35。
   * 参照コーパスの sus 出現率 (profile.harmony.susShare) を渡すと統計に寄る。
   */
  susProbability?: number;
};

export type ColorResult = { plan: Plan; changes: number; reverted: boolean };

const isPlainTriad = (symbol: string) => /^[A-G][#b]?$/.test(symbol);

/** 借用・二次ドミナントを混ぜる。最後の2小節と最初の2小節は触らない */
export function colorPlan(plan: Plan, bars: number, seed: number, opts: ColorOptions = {}): ColorResult {
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  if (strength <= 0) return { plan, changes: 0, reverted: false };
  const susP = Math.max(0.05, Math.min(0.5, opts.susProbability ?? 0.35));
  const susThreshold = susP * strength;
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const totalBeats = bars * beatsPerBar;
  const key = parseKeyName(plan.key);
  const rand = mulberry32((seed ^ 0x2c1b3d4e) >>> 0);
  const maxChanges = opts.maxChanges ?? Math.max(2, Math.round(bars / 4));

  const chords = [...plan.chords].sort((a, b) => a[0] - b[0]).map(([beat, symbol]) => [beat, symbol] as [number, string]);
  let changes = 0;
  // 4小節周期で同じ (小節内位相, 現在コード, 次コード) には同じ色彩化決定を再利用し、
  // 反復進行のテーマ性 (1周目と2周目の一貫性) を壊さないようにする
  const decisions = new Map<string, string | null>();
  for (let i = 1; i < chords.length - 1; i++) {
    if (changes >= maxChanges) break;
    const [beat, symbol] = chords[i]!;
    // 曲の頭と終わり、転調の直後は避ける
    if (beat < 2 * beatsPerBar || beat >= totalBeats - 2 * beatsPerBar) continue;
    const next = chords[i + 1]![1];
    const barPhase = Math.floor(beat / beatsPerBar) % 4;
    const slotKey = `${barPhase}:${symbol}->${next}`;

    let replacement: string | null = null;
    if (decisions.has(slotKey)) {
      replacement = decisions.get(slotKey) ?? null;
    } else {
      const r = rand();
      if (r < susThreshold && isPlainTriad(symbol)) {
        // sus4: 参照コーパスで多用される (解決しない浮遊感)
        replacement = `${symbol}sus4`;
      } else if (r < 0.65 * strength) {
        // 二次ドミナント: 次の和音へ V7 で導く
        try {
          const targetRoot = parseChord(next).root;
          const domRoot = (targetRoot + 7) % 12;
          const currentRoot = parseChord(symbol).root;
          if (domRoot !== currentRoot && !next.includes("/")) {
            replacement = `${pcName(domRoot, false)}7`;
          }
        } catch { /* noop */ }
      } else if (r < 0.8 * strength) {
        // 借用: iv / bVII / bVI (同主短調・ミクソリディアンからの色)
        const borrowed = borrowedCandidates(key);
        if (borrowed.length > 0) replacement = borrowed[Math.floor(rand() * borrowed.length)]!;
      }
      decisions.set(slotKey, replacement);
    }

    if (!replacement || replacement === symbol) continue;
    // 置換後に解析できるか (コード記号として妥当か)
    try {
      analyzeChord(replacement, key);
      parseChord(replacement);
      chords[i] = [beat, replacement];
      changes++;
    } catch { /* 無効な置換は捨てる */ }
  }

  const nextPlan: Plan = { ...plan, chords };
  // 和声として破綻していないか確認し、error が増えたら元に戻す
  const before = validatePlan(plan, bars).filter((i) => i.severity === "error").length;
  const after = validatePlan(nextPlan, bars).filter((i) => i.severity === "error").length;
  if (after > before) return { plan, changes: 0, reverted: true };
  return { plan: nextPlan, changes, reverted: false };
}

/** 借用和音の候補 (キーに対する度数から作る) */
function borrowedCandidates(key: KeyContext): string[] {
  const out: string[] = [];
  const push = (symbol: string) => {
    try {
      const a = analyzeChord(symbol, key);
      if (!a.isDiatonic) out.push(symbol);
    } catch { /* noop */ }
  };
  // 同主短調からの借用: iv, bVI, bVII
  push(degreeChord(key, 4, key.mode === "major" ? "min" : "maj"));
  push(degreeChord(key, 6, key.mode === "major" ? "maj" : "min", key.mode === "major" ? -1 : 0));
  push(degreeChord(key, 7, key.mode === "major" ? "maj" : "min", key.mode === "major" ? -1 : 0));
  // ナポリ (bII)
  push(degreeChord(key, 2, "maj", -1));
  void degreePc;
  return out;
}
