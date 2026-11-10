/**
 * 進行の自動補正。デフォルトは決定的 (乱数なし) で既存テストと互換。
 * 多様化したい場合は RepairOptions を渡す (seed 付き決定的乱数)。
 * keyChanges がある場合は区間ごとの調で判定する。
 */

import { keyAtBeat, resolveSections, type Plan } from "../plan";
import { cadenceAt } from "./cadence";
import { isRetrogression } from "./functions";
import { degreeChord, parseKeyName, type KeyContext } from "./key";
import { analyzeChord } from "./roman";
import { mulberry32 } from "../util/random";
import type { Issue } from "./validate";

type Chord = [number, string];

export type RepairOptions = {
  /** 指定すると決定的乱数で補正先を分散させる。未指定なら従来通り V-I 固定 */
  seed?: number;
  /** 'strict' (既定): セクション境界の直前を必ずV化。'loose': seedで約半分だけ残す */
  sectionCadence?: "strict" | "loose";
  /** 'authentic' (既定): V-I 固定。'varied': V-I / IV-I / V-vi からseed選択 */
  closing?: "authentic" | "varied";
};

const tonicChord = (key: KeyContext) => degreeChord(key, 1, key.mode === "major" ? "maj" : "min");
const dominantChord = (key: KeyContext) => degreeChord(key, 5, "dom7");
const subdominantChord = (key: KeyContext) => degreeChord(key, 4, key.mode === "major" ? "maj" : "min");
const deceptiveChord = (key: KeyContext) => degreeChord(key, 6, key.mode === "major" ? "min" : "maj");

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

export function repairPlan(plan: Plan, bars: number, opts: RepairOptions = {}): { plan: Plan; fixes: Issue[] } {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const total = bars * beatsPerBar;
  const mainKey = parseKeyName(plan.key);
  const keyChanges = [...(plan.keyChanges ?? [])]
    .filter((kc) => kc.bar >= 0 && kc.bar < bars)
    .sort((a, b) => a.bar - b.bar)
    .filter((kc, i, arr) => i === 0 || kc.bar !== arr[i - 1]!.bar);
  const withKeys = { ...plan, keyChanges };
  const localKey = (beat: number): KeyContext => parseKeyName(keyAtBeat(withKeys, beat, beatsPerBar));
  const fixes: Issue[] = [];
  const chords = normalize(plan.chords, total, mainKey);
  const rand = opts.seed !== undefined ? mulberry32(opts.seed) : null;
  const varied = opts.closing === "varied" && rand !== null;
  // varied時の終止バリエーション: 6割 V-I / 2割 IV-I / 2割 V-vi
  const variant: "authentic" | "plagal" | "deceptive" = !varied
    ? "authentic"
    : (() => { const r = rand!(); return r < 0.6 ? "authentic" : r < 0.8 ? "plagal" : "deceptive"; })();

  // 機能の逆行は 2 和音を入れ替える (V -> IV を IV -> V に)。転調区間は区間の調で判定
  for (let i = 0; i + 1 < chords.length; i++) {
    const a = analyzeChord(chords[i]![1], localKey(chords[i]![0]));
    const b = analyzeChord(chords[i + 1]![1], localKey(chords[i + 1]![0]));
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

  const hasTonic = () => chords.some(([, symbol], i) => {
    const a = analyzeChord(symbol, localKey(chords[i]![0]));
    return a.degree === 1 && a.accidental === 0;
  });

  // トニックが一度も出ない
  if (!hasTonic()) {
    chords[0] = [0, tonicChord(mainKey)];
    fixes.push({
      code: "NO_TONIC",
      severity: "warn",
      beat: 0,
      message: `Set the first chord to the tonic ${tonicChord(mainKey)}.`,
    });
  }

  if (plan.loop) {
    // ループ用: 最終和音が導音でもトニックでもなければ V7 にして次の周へつなぐ
    const lastIdx = chords.length - 1;
    const lastKey = localKey(chords[lastIdx]![0]);
    const last = analyzeChord(chords[lastIdx]![1], lastKey);
    const lastIsTonic = last.degree === 1 && last.accidental === 0;
    if (last.fn !== "D" && !lastIsTonic) {
      const before = chords[lastIdx]![1];
      chords[lastIdx] = [chords[lastIdx]![0], dominantChord(lastKey)];
      fixes.push({
        code: "LOOP_LEAD_IN",
        severity: "warn",
        beat: chords[lastIdx]![0],
        message: `Replaced the final ${before} with the dominant ${dominantChord(lastKey)} so the loop resolves back to the start.`,
      });
    }
  } else {
    // 最終和音を最終区間のトニックへ (varied + deceptive のときは vi/VI で偽終止)
    const lastIdx = chords.length - 1;
    const finalKey = localKey(chords[lastIdx]![0]);
    const last = analyzeChord(chords[lastIdx]![1], finalKey);
    if (variant === "deceptive") {
      const target = deceptiveChord(finalKey);
      if (chords[lastIdx]![1] !== target) {
        const before = chords[lastIdx]![1];
        chords[lastIdx] = [chords[lastIdx]![0], target];
        fixes.push({
          code: "WEAK_ENDING",
          severity: "warn",
          beat: chords[lastIdx]![0],
          message: `Replaced the final ${before} with ${target} for a deceptive cadence (V-vi).`,
        });
      }
    } else if (last.degree !== 1 || last.accidental !== 0) {
      const before = chords[lastIdx]![1];
      chords[lastIdx] = [chords[lastIdx]![0], tonicChord(finalKey)];
      fixes.push({
        code: "WEAK_ENDING",
        severity: "warn",
        beat: chords[lastIdx]![0],
        message: `Replaced the final ${before} with the tonic ${tonicChord(finalKey)}.`,
      });
    }

    // 終止がなければ、最後の和音の直前 (伸ばしを除く) で終止を作る
    if (chords.length >= 2) {
      const analyses = chords.map(([beat, symbol]) => analyzeChord(symbol, localKey(beat)));
      if (cadenceAt(analyses) === "none") {
        let j = chords.length - 2;
        while (j > 0 && analyses[j]!.numeral === analyses[analyses.length - 1]!.numeral) j--;
        const before = chords[j]![1];
        const preKey = localKey(chords[j]![0]);
        if (variant === "plagal") {
          chords[j] = [chords[j]![0], subdominantChord(preKey)];
          fixes.push({
            code: "NO_CADENCE",
            severity: "warn",
            beat: chords[j]![0],
            message: `Replaced ${before} with ${subdominantChord(preKey)} to close with IV-I.`,
          });
        } else {
          // authentic / deceptive とも直前は V7 (deceptive は V-vi になる)
          chords[j] = [chords[j]![0], dominantChord(preKey)];
          fixes.push({
            code: "NO_CADENCE",
            severity: "warn",
            beat: chords[j]![0],
            message: variant === "deceptive"
              ? `Replaced ${before} with the dominant ${dominantChord(preKey)} to close with V-vi.`
              : `Replaced ${before} with the dominant ${dominantChord(preKey)} to close with V-I.`,
          });
        }
      }
    }
  }

  // セクション境界の直前をドミナントにする (最終和音は壊さない)
  // loose では seed で約半分をスキップし、LLMの書いた進行を残す
  for (const s of resolveSections(plan, bars, beatsPerBar).slice(1)) {
    let idx = -1;
    for (let i = 0; i < chords.length; i++) if (chords[i]![0] < s.start) idx = i;
    if (idx < 0 || idx === chords.length - 1) continue;
    const secKey = localKey(chords[idx]![0]);
    if (analyzeChord(chords[idx]![1], secKey).fn === "D") continue;
    if (opts.sectionCadence === "loose" && rand !== null && rand() < 0.5) continue;
    const before = chords[idx]![1];
    chords[idx] = [chords[idx]![0], dominantChord(secKey)];
    fixes.push({
      code: "SECTION_CADENCE",
      severity: "warn",
      beat: s.start,
      message: `Replaced ${before} with the dominant ${dominantChord(secKey)} before section ${s.name}.`,
    });
  }

  return { plan: { ...plan, chords, keyChanges }, fixes };
}
