/**
 * テクスチャ層: パッド・モチーフ型アルペジオリフ・16分オスティナート・ハモリを生成する。
 * 主旋律が常に最前面・最高音域で聴こえるよう、主旋律が存在する区間では
 * 補助声部の音域上限 (シーリング) とベロシティを自動で抑える (ダイナミック・ダッキング)。
 */

import { gainAt, keyAtBeat, sectionAt, type Plan, type Section } from "../plan";
import type { Note } from "../score";
import { parseChord, type Chord } from "./harmony";
import { chordAt, toSegments, type Arrangement, type ChordEvent } from "./accompaniment";
import { parseKey, SCALES } from "./index";
import { parseKeyName } from "./key";
import { voiceProgression } from "./voicing";
import { mulberry32 } from "../util/random";

const cutsOf = (a: Arrangement) => [...a.sections.map((s) => s.start), a.totalBeats - a.beatsPerBar];
const isEnding = (a: Arrangement, beat: number) => !a.loop && a.sections.length > 0 && beat >= a.totalBeats - a.beatsPerBar - 1e-6;

/** セクションのエネルギー (1-3) */
const energyOf = (s: Section): 1 | 2 | 3 => (s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2);

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * 1小節 (16ステップ) のモチーフ型リフ・パターン辞書。
 * 単調な上下往復ではなく、ゲーム音楽特有のペダルポイント・シンコペーション・フック音型を持つ。
 * 数値は chordPitches() のインデックス (0=root, 1=3rd, 2=5th, 3=7th/octave)。
 */
const ARP_RIFF_PATTERNS: readonly (readonly number[])[] = [
  // 0: 3+3+2 トレシロ・フック (頭と裏拍に高音フック)
  [0, 1, 2, 3, 1, 2, 3, 1, 0, 2, 1, 3, 2, 1, 2, 0],
  // 1: ペダル・ギャロップ (ルートを軸に上声部が動くファルコム/STG風)
  [0, 0, 2, 0, 3, 2, 1, 0, 0, 0, 2, 0, 3, 1, 2, 3],
  // 2: 下降シーケンス・フック (高音から駆け下りて跳ね上がる)
  [3, 2, 1, 0, 2, 1, 0, 1, 3, 2, 1, 0, 1, 2, 3, 2],
  // 3: オクターブ・バウンス (推進力のあるシンセリード・バッキング)
  [0, 3, 1, 2, 0, 3, 2, 1, 0, 3, 1, 2, 3, 2, 1, 2],
];

const SEQ16_RIFF_PATTERNS: readonly (readonly number[])[] = [
  // 0: ルートペダル + 5度/3度リフ
  [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 2, 0, 3, 2, 1, 2],
  // 1: シンコペーション・オスティナート (3+3+2 アクセント)
  [0, 2, 1, 0, 2, 1, 0, 2, 0, 3, 2, 1, 0, 2, 1, 2],
  // 2: ドライビング・シーケンス
  [0, 1, 2, 1, 0, 2, 3, 2, 0, 1, 2, 1, 3, 2, 1, 0],
  // 3: 80s アーケード・パルス
  [0, 2, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1, 2, 3, 2, 1],
];

/** 16ステップ内のアクセント重み (3+3+2 シンコペーションと拍頭を強調) */
const STEP16_ACCENT = [
  1.12, 0.78, 0.85, 1.05,
  0.82, 0.78, 1.04, 0.80,
  1.08, 0.78, 0.85, 1.02,
  0.84, 0.78, 0.96, 0.80,
];

/** 指定区間 [from, to) で主旋律が鳴っているか、およびその最低ピッチを返す */
function melodyActivityAt(melody: Note[] | undefined, from: number, to: number): { active: boolean; minPitch: number } {
  if (!melody || melody.length === 0) return { active: false, minPitch: 84 };
  let minPitch = Infinity;
  let active = false;
  for (const n of melody) {
    if (n.start < to - 1e-4 && n.start + n.duration > from + 1e-4) {
      active = true;
      if (n.pitch < minPitch) minPitch = n.pitch;
    }
  }
  return { active, minPitch: active ? minPitch : 84 };
}

/** パッド: 小節あたり1回、和音を中音域で薄く伸ばす (主旋律を邪魔しない音域・音量に抑える) */
export function generatePad(events: ChordEvent[], a: Arrangement, opts: { melody?: Note[] } = {}): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const voicings = voiceProgression(sorted.map((e) => parseChord(e.symbol)));
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    if (energyOf(sec) === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const v = voicings[seg.index] ?? [];
    if (v.length === 0) continue;
    const { active, minPitch } = melodyActivityAt(opts.melody, seg.start, seg.start + seg.len);
    const ceiling = active ? Math.max(67, minPitch - 2) : 84;
    // ボイシング全体を主旋律シーリング以下・中音域 (60..91) に一括シフト (個別オクターブ移動による短2度クラッシュを防ぐ)
    let shifted = [...v];
    while (shifted.some((p) => p < 60) && shifted.every((p) => p + 12 <= ceiling)) {
      shifted = shifted.map((p) => p + 12);
    }
    while (shifted.some((p) => p > ceiling) && shifted.every((p) => p - 12 >= 60)) {
      shifted = shifted.map((p) => p - 12);
    }
    // 隣り合う声部が短2度 (半音差) になっている場合は、オクターブを離して不協和音を解消
    shifted.sort((a, b) => a - b);
    for (let i = 1; i < shifted.length; i++) {
      const prev = shifted[i - 1];
      const cur = shifted[i];
      if (prev !== undefined && cur !== undefined && cur - prev === 1) {
        if (cur + 12 <= 91) {
          shifted[i] = cur + 12;
        } else if (prev - 12 >= 60) {
          shifted[i - 1] = prev - 12;
        }
      }
    }
    const pitches = [...new Set(shifted.filter((p) => p >= 60 && p <= 91))].sort((a, b) => a - b);
    const len = Math.min(seg.len, a.beatsPerBar) - 0.08;
    if (len <= 0.1) continue;
    const g = gainAt(sec, seg.start);
    const baseVel = active ? 38 : 46;
    for (const p of pitches) {
      out.push({
        pitch: p,
        start: seg.start,
        duration: len,
        velocity: Math.max(1, Math.min(127, Math.round(baseVel * g))),
      });
    }
  }
  return out;
}

/**
 * モチーフ型アルペジオリフ:
 * - 曲固有の1小節(16ステップ)リフ・パターンをコード進行に沿って反復する
 * - 主旋律が休んでいる区間 (intro/interlude やブレス隙間) では中高音へ出てフックを聴かせ、
 *   主旋律が歌っている区間では主旋律より低い音域・控えめな音量へ自動でダッキングする
 */
/** 固定リフの反復で単調にならないよう、seedから別リフを選ぶ */
function alternateRiff(patterns: readonly (readonly number[])[], primary: number, seed: number | undefined): readonly number[] {
  if (seed === undefined || patterns.length < 2) return patterns[primary % patterns.length]!;
  const rand = mulberry32((seed ^ 0x6d2b79f5) >>> 0);
  const offset = 1 + Math.floor(rand() * (patterns.length - 1));
  return patterns[(primary + offset) % patterns.length]!;
}

/** 小節ごとの決定的な揺らぎ (0-1)。barIdx が同じなら常に同じ値 */
function barRandom(seed: number | undefined, barIdx: number, salt = 0): number {
  if (seed === undefined) return 0;
  const rand = mulberry32((seed ^ Math.imul(barIdx + 1, 0x9e3779b1) ^ salt) >>> 0);
  return rand();
}

export function generateArp(
  events: ChordEvent[],
  a: Arrangement,
  opts: { seed?: number; sixteenth?: boolean; melody?: Note[] } = {},
): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  const patIdx = Math.abs(opts.seed ?? 0) % ARP_RIFF_PATTERNS.length;
  const riffA = ARP_RIFF_PATTERNS[patIdx]!;
  // フレーズ後半で別のリフへ切り替える (同一1小節の無限反復を避ける)
  const riffB = alternateRiff(ARP_RIFF_PATTERNS, patIdx, opts.seed);
  // フレーズ2小節目で上行、4小節目で「息継ぎ」するための位相
  const PHRASE_BARS = 4;

  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    const energy = energyOf(sec);
    if (energy === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const g = gainAt(sec, seg.start);
    const isInstrumentalRole = sec.role === "intro" || sec.role === "interlude" || sec.role === "solo";
    // 主旋律がいない区間は高め (64)、いる区間は中低音 (55) を基準にする
    const basePitch = opts.melody ? (isInstrumentalRole ? 64 : 55) : 60;
    const tones = chordPitches(seg.chord, basePitch);
    if (tones.length === 0) continue;

    const dense = energy >= 3
      || (energy === 2 && (opts.sixteenth === true || sec.role === "chorus" || sec.role === "prechorus" || isInstrumentalRole));
    const step = dense ? 0.25 : 0.5;
    for (let s = 0, i = 0; s < seg.len - 0.05; s += step, i++) {
      const beatNow = seg.start + s;
      const barIdx = Math.round(beatNow / a.beatsPerBar);
      const phrasePos = ((barIdx % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
      const riff = phrasePos >= 2 ? riffB : riffA;
      const stepInBar = Math.round(((beatNow % a.beatsPerBar) / a.beatsPerBar) * 16) % 16;
      const deg = riff[stepInBar] ?? (i % tones.length);
      let pitch = tones[deg % tones.length]!;

      // 主旋律が鳴っている瞬間は、主旋律の最低音より下 (上限66) に折り畳んで主旋律を最前面に出す
      const mel = melodyActivityAt(opts.melody, beatNow, beatNow + step);
      // 4小節目の末尾8分は「息継ぎ」として抜く (主旋律が休んでいる区間のみ)
      if (opts.seed !== undefined && !mel.active && phrasePos === PHRASE_BARS - 1 && stepInBar >= 14) continue;
      if (mel.active) {
        const ceiling = Math.max(58, Math.min(66, mel.minPitch - 3));
        while (pitch > ceiling && pitch - 12 >= 48) pitch -= 12;
      } else if (phrasePos === 2 && opts.seed !== undefined && pitch + 12 <= 88 && barRandom(opts.seed, barIdx, 0x51) < 0.7) {
        // フレーズ3小節目は1オクターブ上へ出てフックを強調
        pitch += 12;
      }
      const accent = STEP16_ACCENT[stepInBar] ?? 0.85;
      const baseV = mel.active ? 44 : 60;
      // フレーズ内で僅かにクレッシェンド + 小節ごとの揺らぎ
      const phraseGain = mel.active ? 1 : 0.92 + 0.08 * (phrasePos / (PHRASE_BARS - 1));
      const jitter = 1 + (barRandom(opts.seed, barIdx, stepInBar) - 0.5) * 0.08;
      out.push({
        pitch,
        start: beatNow,
        duration: Math.min(step * 0.88, seg.len - s - 0.02),
        velocity: Math.max(1, Math.min(127, Math.round(baseV * accent * g * phraseGain * jitter))),
      });
    }
  }
  return out;
}

/**
 * 16分オスティナート・シーケンス:
 * 曲固有の1小節リフ音型を中低域 (MIDI 55..66) でタイトに刻み、リズムの推進力を作る。
 * seed指定時は2種のリフをフレーズごとに切り替え、末尾で抜いて単調さを避ける。
 */
export function generateSeq16(
  events: ChordEvent[],
  a: Arrangement,
  opts: { seed?: number; melody?: Note[] } = {},
): Note[] {
  const out: Note[] = [];
  const sorted = [...events].sort((x, y) => x.start - y.start).filter((e) => e.start < a.totalBeats);
  if (sorted.length === 0) return out;
  const segments = toSegments(events, a.totalBeats, cutsOf(a));
  const patIdx = Math.abs((opts.seed ?? 0) + 1) % SEQ16_RIFF_PATTERNS.length;
  const riffA = SEQ16_RIFF_PATTERNS[patIdx]!;
  const riffB = alternateRiff(SEQ16_RIFF_PATTERNS, patIdx, opts.seed);
  const PHRASE_BARS = 4;

  for (const seg of segments) {
    const sec = sectionAt(a.sections, seg.start);
    const energy = energyOf(sec);
    if (energy === 1 || sec.role === "break" || isEnding(a, seg.start)) continue;
    const g = gainAt(sec, seg.start);
    const tones = chordPitches(seg.chord, 55);
    if (tones.length < 2) continue;
    const startBar = Math.ceil(seg.start / a.beatsPerBar) * a.beatsPerBar;
    for (let beat = startBar; beat < seg.start + seg.len - 1e-6; beat += a.beatsPerBar) {
      const barEnd = Math.min(beat + a.beatsPerBar, seg.start + seg.len);
      const barIdx = Math.round(beat / a.beatsPerBar);
      const phrasePos = ((barIdx % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
      // 1-2小節目はリフA、3-4小節目はリフB (フレーズ内で音型が動く)
      const riff = phrasePos >= 2 ? riffB : riffA;
      const mel = melodyActivityAt(opts.melody, beat, barEnd);
      const ceiling = mel.active ? Math.max(60, Math.min(66, mel.minPitch - 3)) : 70;
      // フレーズ末尾は最後の1拍を抜いて「切れ目」を作る (主旋律が休んでいる区間のみ)
      const breakAt = opts.seed !== undefined && !mel.active && phrasePos === PHRASE_BARS - 1 ? 12 : 16;
      const phraseGain = 0.94 + 0.06 * (phrasePos / (PHRASE_BARS - 1));
      for (let s = 0, i = 0; beat + s < barEnd - 0.05; s += 0.25, i++) {
        if (i >= breakAt) continue;
        const deg = riff[i % riff.length]!;
        let pitch = tones[deg % tones.length]!;
        while (pitch > ceiling && pitch - 12 >= 55) pitch -= 12;
        if (pitch < 55) pitch += 12;
        const accent = STEP16_ACCENT[i % 16] ?? 0.85;
        const baseV = mel.active ? 42 : 54;
        const jitter = 1 + (barRandom(opts.seed, barIdx, i) - 0.5) * 0.06;
        out.push({
          pitch,
          start: beat + s,
          duration: 0.22,
          velocity: Math.max(1, Math.min(127, Math.round(baseV * accent * g * phraseGain * jitter))),
        });
      }
      if (out.length > 4000) break;
    }
  }
  return out;
}

/** コードの構成音を指定音域付近へ並べる */
function chordPitches(chord: Chord, base: number): number[] {
  const tones = [...new Set(chord.tones)];
  const out: number[] = [];
  for (const t of tones) {
    let p = base + ((t - (base % 12) + 12) % 12);
    if (p < base) p += 12;
    if (p <= 96) out.push(p);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** ハモリ: 主旋律に協和する3度下〜6度下を付ける (長い音だけ、コード進行・スケールと不協和衝突しない音を選択)
 *  seed指定時はフレーズごとに音程ファミリー (3度下 / 6度下 / オクターブ下) を切り替え、
 *  適度に休符を挟んで単調な並行移動を避ける。
 */
export function generateHarmony(
  melody: Note[],
  plan: Plan,
  beatsPerBar: number,
  opts: { minDuration?: number; chords?: ChordEvent[]; seed?: number } = {},
): Note[] {
  const minDuration = opts.minDuration ?? 0.5;
  const out: Note[] = [];
  const chords: ChordEvent[] =
    opts.chords ??
    (plan.chords && plan.chords.length > 0
      ? plan.chords.map(([start, symbol]) => ({ start, symbol }))
      : []);
  let lastEnd = -1;
  const rand = opts.seed !== undefined ? mulberry32((opts.seed ^ 0xc2b2ae35) >>> 0) : null;
  // 2小節ごとにハモリの音程ファミリーを変える (0: 3度下, 1: 6度下/オクターブ下)
  const familyOf = (beat: number) => Math.floor(beat / (2 * beatsPerBar)) % 3;

  for (const n of [...melody].sort((a, b) => a.start - b.start)) {
    if (n.duration < minDuration || n.start < lastEnd) continue;
    const key = parseKeyName(keyAtBeat(plan, n.start, beatsPerBar));
    const { root, scale } = parseKey(`${NOTE[key.root]} ${key.mode}`);
    const scaleSet = new Set(SCALES[scale]!.map((i) => (i + root) % 12));

    const curChord = chords.length > 0 ? chordAt(chords, n.start) : null;
    const chordTonePcs = curChord ? new Set(curChord.tones.map((t) => (t % 12 + 12) % 12)) : null;

    // seed指定時: ところどころ休ませて並行ハモリの単調さを崩す (フレーズ頭は残す)
    if (rand && rand() < 0.14 && n.start % (2 * beatsPerBar) > 0.25) continue;

    // 候補音: ファミリーごとに優先する音程を変える
    const family = opts.seed !== undefined ? familyOf(n.start) : 0;
    const candidateDeltas = family === 1
      ? [8, 9, 12, 3, 4]
      : family === 2
        ? [12, 8, 9, 3, 4]
        : [3, 4, 5, 8, 9, 2];
    let bestPitch: number | null = null;
    let bestScore = -Infinity;

    for (const delta of candidateDeltas) {
      const p = n.pitch - delta;
      if (p < 48 || p > 96) continue;
      const pc = (p % 12 + 12) % 12;

      // スケール内またはコードトーンであること
      const inScale = scaleSet.has(pc);
      const inChord = chordTonePcs ? chordTonePcs.has(pc) : false;
      if (!inScale && !inChord) continue;

      // 主旋律との衝突チェック:
      // 同音(0)・短2度(1)・短9度(13 / pc差 1 or 11) は厳禁
      const melDiffPc = Math.abs((n.pitch % 12) - pc);
      if (melDiffPc === 0 && Math.abs(n.pitch - p) < 12) continue;
      if (melDiffPc === 1 || melDiffPc === 11) continue;

      // コードトーンとの衝突チェック:
      // コードトーンのいずれかと短2度・短9度 (半音差) になる音は避ける
      let clashesWithChord = false;
      if (chordTonePcs) {
        for (const ct of chordTonePcs) {
          const diff = Math.abs(pc - ct);
          if (diff === 1 || diff === 11) {
            clashesWithChord = true;
            break;
          }
        }
      }
      if (clashesWithChord) continue;

      // スコアリング (ファミリーの優先音程を加点)
      let score = 0;
      if (inChord) score += 50;
      if (family === 1 && (delta === 8 || delta === 9)) score += 40;
      else if (family === 2 && delta === 12) score += 40;
      else if (family === 0 && (delta === 3 || delta === 4)) score += 35;
      if (delta === 3 || delta === 4) score += 15;
      else if (delta === 8 || delta === 9) score += 12;
      else if (delta === 5) score += 8;
      else if (delta === 12) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestPitch = p;
      }
    }

    if (bestPitch === null) continue;

    out.push({
      ...n,
      pitch: bestPitch,
      velocity: Math.max(1, Math.round(n.velocity * 0.72)),
    });
    lastEnd = n.start + n.duration;
  }
  return out;
}


