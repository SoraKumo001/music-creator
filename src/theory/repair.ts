/**
 * 進行の決定的な自動補正。乱数は使わない。
 * 補正した内容は Issue (warn) として返し、呼び出し側がログに残せるようにする。
 */

import { resolveSections, type Plan } from "../plan";
import { cadenceAt } from "./cadence";
import { isRetrogression } from "./functions";
import { degreeChord, parseKeyName, type KeyContext } from "./key";
import { analyzeChord } from "./roman";
import type { Issue } from "./validate";

type Chord = [number, string];

const tonicChord = (key: KeyContext) => degreeChord(key, 1, key.mode === "major" ? "maj" : "min");
const dominantChord = (key: KeyContext) => degreeChord(key, 5, "dom7");

/** 拍グリッドへスナップし、同じ拍の重複を落とし、先頭を 0 拍に置く */
function normalize(chords: Chord[], total: number, key: KeyContext): Chord[] {
  const snapped = chords
    .filter(([start]) => start < total)
    .map(([start, symbol]) => [Math.max(0, Math.min(total - 1, Math.round(start))), symbol] as Chord)
    .sort((a, b) => a[0] - b[0]);

  const out: Chord[] = [];
  for (const c of snapped) {
    if (out.length > 0 && out[out.length - 1]![0] === c[0]) continue;
    out.push(c);
  }
  if (out.length === 0) out.push([0, tonicChord(key)]);
  if (out[0]![0] > 0) out[0] = [0, out[0]![1]];
  return out;
}

export function repairPlan(plan: Plan, bars: number): { plan: Plan; fixes: Issue[] } {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const total = bars * beatsPerBar;
  const key = parseKeyName(plan.key);
  const fixes: Issue[] = [];
  const chords = normalize(plan.chords, total, key);

  // 機能の逆行は 2 和音を入れ替える (V -> IV を IV -> V に)
  for (let i = 0; i + 1 < chords.length; i++) {
    const a = analyzeChord(chords[i]![1], key);
    const b = analyzeChord(chords[i + 1]![1], key);
    if (!isRetrogression(a, b)) continue;
    const [first, second] = [chords[i]![1], chords[i + 1]![1]];
    chords[i] = [chords[i]![0], second];
    chords[i + 1] = [chords[i + 1]![0], first];
    fixes.push({
      code: "RETROGRESSION",
      severity: "warn",
      beat: chords[i + 1]![0],
      message: `Swapped ${first} and ${second} to remove a D -> S retrogression.`,
    });
  }

  const hasTonic = () => chords.some(([, symbol]) => {
    const a = analyzeChord(symbol, key);
    return a.degree === 1 && a.accidental === 0;
  });

  // トニックが一度も出ない
  if (!hasTonic()) {
    chords[0] = [0, tonicChord(key)];
    fixes.push({
      code: "NO_TONIC",
      severity: "warn",
      beat: 0,
      message: `Set the first chord to the tonic ${tonicChord(key)}.`,
    });
  }

  if (plan.loop) {
    // ループ用: 最終和音が導音でもトニックでもなければ V7 にして次の周へつなぐ
    const lastIdx = chords.length - 1;
    const last = analyzeChord(chords[lastIdx]![1], key);
    const lastIsTonic = last.degree === 1 && last.accidental === 0;
    if (last.fn !== "D" && !lastIsTonic) {
      const before = chords[lastIdx]![1];
      chords[lastIdx] = [chords[lastIdx]![0], dominantChord(key)];
      fixes.push({
        code: "LOOP_LEAD_IN",
        severity: "warn",
        beat: chords[lastIdx]![0],
        message: `Replaced the final ${before} with the dominant ${dominantChord(key)} so the loop resolves back to the start.`,
      });
    }
  } else {
    // 最終和音をトニックへ
    const lastIdx = chords.length - 1;
    const last = analyzeChord(chords[lastIdx]![1], key);
    if (last.degree !== 1 || last.accidental !== 0) {
      const before = chords[lastIdx]![1];
      chords[lastIdx] = [chords[lastIdx]![0], tonicChord(key)];
      fixes.push({
        code: "WEAK_ENDING",
        severity: "warn",
        beat: chords[lastIdx]![0],
        message: `Replaced the final ${before} with the tonic ${tonicChord(key)}.`,
      });
    }

    // 終止がなければ、最後の和音の直前 (伸ばしを除く) を V7 にして V-I を作る
    if (chords.length >= 2) {
      const analyses = chords.map(([, symbol]) => analyzeChord(symbol, key));
      if (cadenceAt(analyses) === "none") {
        let j = chords.length - 2;
        while (j > 0 && analyses[j]!.numeral === analyses[analyses.length - 1]!.numeral) j--;
        const before = chords[j]![1];
        chords[j] = [chords[j]![0], dominantChord(key)];
        fixes.push({
          code: "NO_CADENCE",
          severity: "warn",
          beat: chords[j]![0],
          message: `Replaced ${before} with the dominant ${dominantChord(key)} to close with V-I.`,
        });
      }
    }
  }

  // セクション境界の直前をドミナントにする (最終和音は壊さない)
  for (const s of resolveSections(plan, bars, beatsPerBar).slice(1)) {
    let idx = -1;
    for (let i = 0; i < chords.length; i++) if (chords[i]![0] < s.start) idx = i;
    if (idx < 0 || idx === chords.length - 1) continue;
    if (analyzeChord(chords[idx]![1], key).fn === "D") continue;
    const before = chords[idx]![1];
    chords[idx] = [chords[idx]![0], dominantChord(key)];
    fixes.push({
      code: "SECTION_CADENCE",
      severity: "warn",
      beat: s.start,
      message: `Replaced ${before} with the dominant ${dominantChord(key)} before section ${s.name}.`,
    });
  }

  return { plan: { ...plan, chords }, fixes };
}
