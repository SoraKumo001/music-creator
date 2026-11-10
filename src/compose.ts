import { z } from "zod";
import {
  chat,
  type ChatMessage,
  type LlmConfig,
  type Usage,
} from "./llm/provider";
import { scoreToMidi } from "./midi/toMidi";
import { normalizeScore } from "./normalize";
import {
  keyAtBeat,
  PlanSchema,
  resolveEnding,
  resolveSections,
  type Complexity,
  type Ensemble,
  type Plan,
  type Section,
} from "./plan";
import { melodyMessages, planMessages } from "./prompt";
import { NoteSchema, ScoreSchema, type Note, type Score } from "./score";
import {
  chordAt,
  generateBass,
  generateComp,
  type Arrangement,
  type ChordEvent,
} from "./theory/accompaniment";
import { generateDrums } from "./theory/drums";
import { parseChord } from "./theory/harmony";
import {
  developTheme,
  polishMelody,
  scoreMelody,
  type MelodyContext,
  type MelodyScore,
} from "./theory/melody";
import { repairPlan } from "./theory/repair";
import { analyzeChord } from "./theory/roman";
import { parseKeyName } from "./theory/key";
import { parseKey, SCALES } from "./theory/index";
import { mulberry32, pickSoftmaxSeeded, resolveSeed } from "./util/random";
import { generateOrchestra } from "./theory/orchestra";
import {
  generateArp,
  generateHarmony,
  generatePad,
  generateSeq16,
} from "./theory/texture";
import { colorPlan } from "./theory/color";
import { normalizeForm } from "./theory/form";
import { reduceDissonances } from "./theory/dissonance";
import { reharmonizePlan, type ReharmSuggestion } from "./theory/reharmonize";
import {
  applyCorpusHints,
  corpusRuleHints,
  isCalmPrompt,
} from "./knowledge/corpus";
import { validatePlan, type Issue } from "./theory/validate";
import { evaluateComplexity, type ComplexitySummary } from "./eval/complexity";

function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? t.slice(start, end + 1) : t);
}

/** [pitch, start, duration, velocity?] の配列形式を Note[] へ */
export function parseCompactNotes(raw: unknown): Note[] {
  const arr = (raw as { notes?: unknown })?.notes;
  if (!Array.isArray(arr))
    throw new Error(
      'expected {"notes": [[pitch,start,duration,velocity], ...]}',
    );
  return z
    .array(NoteSchema)
    .parse(
      arr.map((n) =>
        Array.isArray(n)
          ? {
              pitch: n[0],
              start: n[1],
              duration: n[2],
              ...(n[3] != null ? { velocity: n[3] } : {}),
            }
          : n,
      ),
    );
}

/** 主旋律や和音パートと音色が被らないよう、候補リストから未使用の GM プログラム番号を選ぶ */
function distinctProgram(
  candidates: readonly number[],
  avoid: readonly number[],
): number {
  const used = new Set(avoid);
  return candidates.find((p) => !used.has(p)) ?? candidates[0]!;
}

/** 設計 + メロディから Score を組み立てる(伴奏・ベース・ドラムはルール層) */
export function assemble(
  plan: Plan,
  sections: Section[],
  melody: Note[],
  bars: number,
  opts: {
    seed?: number;
    counter?: Note[];
    /** パッド・ハモリなど補助声部を足す */
    texture?: boolean;
    /** アルペジオ声部を足す */
    arp?: boolean;
    /** アルペジオを常時16分にする */
    arpSixteenth?: boolean;
  } = {},
): Score {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  if (plan.ensemble === "orchestra") {
    const tracks = generateOrchestra(plan, sections, melody, bars, beatsPerBar);
    return ScoreSchema.parse({
      title: plan.title,
      bpm: plan.bpm,
      timeSignature: plan.timeSignature,
      key: plan.key,
      tracks,
    });
  }
  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({
    start,
    symbol,
  }));
  const a: Arrangement = {
    sections,
    totalBeats: bars * beatsPerBar,
    beatsPerBar,
    ending: resolveEnding(plan),
    loop: plan.loop,
  };
  const counterProg = distinctProgram(
    [61, 48, 11, 29, 73],
    [plan.melodyProgram, plan.compProgram],
  );
  const arpProg = distinctProgram(
    [80, 9, 4, 29, 11],
    [plan.melodyProgram, plan.compProgram, counterProg],
  );
  const seqProg = distinctProgram(
    [plan.compProgram, 81, 38, 29, 4],
    [plan.melodyProgram, arpProg],
  );
  const tracks = [
    {
      name: plan.melodyName,
      program: plan.melodyProgram,
      channel: 0,
      notes: melody,
    },
    ...(opts.counter && opts.counter.length > 0
      ? [
          {
            name: "Counter",
            program: counterProg,
            channel: 3,
            notes: opts.counter,
          },
        ]
      : []),
    ...(opts.texture
      ? [
          {
            name: "Harmony",
            program: 48,
            channel: 6,
            notes: generateHarmony(melody, plan, beatsPerBar, { chords: events }),
          },
        ]
      : []),
    ...(opts.texture
      ? [
          {
            name: "Pad",
            program: 89,
            channel: 4,
            notes: generatePad(events, a, { melody }),
          },
        ]
      : []),
    ...(opts.arp
      ? [
          {
            name: "Arp",
            program: arpProg,
            channel: 5,
            notes: generateArp(events, a, {
              seed: opts.seed,
              sixteenth: opts.arpSixteenth,
              melody,
            }),
          },
        ]
      : []),
    ...(opts.arp
      ? [
          {
            name: "Seq16",
            program: seqProg,
            channel: 7,
            notes: generateSeq16(events, a, { seed: opts.seed, melody }),
          },
        ]
      : []),
    {
      name: "Chords",
      program: plan.compProgram,
      channel: 1,
      notes: generateComp(events, a, { seed: opts.seed, melody }),
    },
    {
      name: "Bass",
      program: plan.bassProgram,
      channel: 2,
      notes: generateBass(events, a, { seed: opts.seed }),
    },
    {
      name: "Drums",
      program: 0,
      channel: 9,
      notes: generateDrums(sections, beatsPerBar, a.ending, a.loop, {
        seed: opts.seed,
      }),
    },
  ].filter((t) => t.notes.length > 0);
  return ScoreSchema.parse({
    title: plan.title,
    bpm: plan.bpm,
    timeSignature: plan.timeSignature,
    key: plan.key,
    tracks,
  });
}

export type ComposeStats = {
  ms: number;
  planMs: number;
  melodyMs: number;
  planAttempts: number;
  outputTokens: number;
  repairs: number;
  candidates: { score: number; notes: number }[];
  chosen: number;
  chosenParts: MelodyScore["parts"];
  /** 不協和音の後処理で修正した数 */
  dissonanceFixes: number;
  /** 後処理後に残った衝突数 */
  dissonancesRemaining: number;
};
export type SectionInfo = {
  name: string;
  startBar: number;
  bars: number;
  role: string;
};
export type HarmonyLine = {
  beat: number;
  symbol: string;
  numeral: string;
  fn: "T" | "S" | "D";
};
export type ComposeResult = {
  score: Score;
  midi: Uint8Array;
  /** 補正・リハモ適用後の最終プラン (評価・デバッグ用) */
  plan: Plan;
  sections: SectionInfo[];
  attempts: number;
  stats: ComposeStats;
  harmony: HarmonyLine[];
  issues: Issue[];
  suggestions: ReharmSuggestion[];
  complexity: ComplexitySummary;
};

export type ComposeOptions = {
  candidates?: number;
  maxAttempts?: number;
  loop?: boolean;
  ensemble?: Ensemble;
  /** 指定すると進行カード選択・補正・メロディ選択を決定的に分散させる */
  seed?: number;
  /** 0-1。高いほど定型を崩す (repair緩和・温度上昇・softmax選択) */
  creativity?: number;
  /** simple=簡素、standard=現行、rich=長尺・転調・対旋律などを許す */
  complexity?: Complexity;
  /** 対旋律トラックを付ける (省略時は rich かつ band のとき true) */
  counterMelody?: boolean;
  /** コーパス統合のマスタースイッチ (false で両方オフ) */
  corpus?: boolean;
  /** コーパス知見をプロンプトへ入れるか (既定 true) */
  corpusPrompt?: boolean;
  /** コーパス統計をルール層へ適用するか (既定 true) */
  corpusRules?: boolean;
};

const TEMPS = [0.7, 0.9, 1.1, 0.8, 1.3];

/** 長い曲は16小節ずつに区切ってメロディを生成する (1回のLLM出力肥大を避ける) */
const CHUNK_BARS = 16;

/** rich向け: 進行の一部を同機能の代理和音に置換して複雑化する (4小節周期の一貫性を保ち、先頭・末尾2小節は除く) */
function applyReharm(
  plan: Plan,
  bars: number,
  beatsPerBar: number,
  seed: number,
): Plan {
  const pool = reharmonizePlan(plan).filter(
    (s) => s.beat >= 2 * beatsPerBar && s.beat < (bars - 2) * beatsPerBar,
  );
  if (pool.length === 0) return plan;
  const rand = mulberry32((seed ^ 0x3e9a6b7c) >>> 0);
  const picked = [...pool].sort(() => rand() - 0.5).slice(0, 2);
  if (picked.length === 0) return plan;
  const byPhaseAndSymbol = new Map<string, string>();
  for (const s of picked) {
    const alt = s.alternatives[Math.floor(rand() * s.alternatives.length)]!;
    const phase = Math.floor(s.beat / beatsPerBar) % 4;
    byPhaseAndSymbol.set(`${phase}:${s.original}`, alt.symbol);
  }
  return {
    ...plan,
    chords: plan.chords.map(([beat, sym]) => {
      if (beat < 2 * beatsPerBar || beat >= (bars - 2) * beatsPerBar)
        return [beat, sym] as [number, string];
      const phase = Math.floor(beat / beatsPerBar) % 4;
      return [beat, byPhaseAndSymbol.get(`${phase}:${sym}`) ?? sym] as [
        number,
        string,
      ];
    }),
  };
}

/** プロンプト -> (1) 曲の設計 -> (2) メロディ候補を並列生成し採点で選択 -> MIDI */
export async function compose(
  cfg: LlmConfig,
  prompt: string,
  bars = 8,
  opts: ComposeOptions = {},
): Promise<ComposeResult> {
  const nCand = Math.max(1, Math.min(5, opts.candidates ?? 3));
  const maxAttempts = opts.maxAttempts ?? 3;
  const loop = opts.loop ?? false;
  const ensemble = opts.ensemble ?? "band";
  const creativity = Math.max(0, Math.min(1, opts.creativity ?? 0.5));
  const complexity: Complexity = opts.complexity ?? "standard";
  const seed = resolveSeed(prompt, opts.seed);
  const rng = mulberry32(seed);
  cfg = { ...cfg, sessionId: cfg.sessionId ?? "mc-" + crypto.randomUUID() };
  const t0 = Date.now();
  let outputTokens = 0;
  const count = (u?: Usage) => {
    outputTokens += u?.completion_tokens ?? 0;
  };

  // ---- (1) 設計 ----
  const useCorpusPrompt = opts.corpus !== false && opts.corpusPrompt !== false;
  const messages: ChatMessage[] = planMessages(prompt, bars, loop, ensemble, {
    seed,
    creativity,
    complexity,
    corpus: useCorpusPrompt,
  });
  let plan: Plan | undefined;
  let planAttempts = 0;
  let lastError = "";
  // creativityが高いほど温度を上げて定型進行から外す
  const planTemp = 0.7 + creativity * 0.6;
  while (!plan && planAttempts < maxAttempts) {
    planAttempts++;
    const res = await chat(cfg, messages, { temperature: planTemp });
    count(res.usage);
    try {
      const p = {
        ...PlanSchema.parse(extractJson(res.content)),
        loop,
        ensemble,
      };
      for (const [, sym] of p.chords) parseChord(sym); // 解釈できないコードは作り直させる
      const errors = validatePlan(p, bars).filter(
        (i) => i.severity === "error",
      );
      if (errors.length > 0)
        throw new Error(
          errors.map((i) => `${i.code}: ${i.message}`).join(" / "),
        );
      plan = p;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push(
        { role: "assistant", content: res.content },
        {
          role: "user",
          content: `The plan was invalid: ${lastError.slice(0, 800)}\nReturn the corrected full JSON only.`,
        },
      );
    }
  }
  if (!plan)
    throw new Error(
      `Failed to design the song after ${maxAttempts} attempts: ${lastError}`,
    );
  const planMs = Date.now() - t0;

  // ---- (1.4) フォーム正規化 (細切れセクションを併合) ----
  if (complexity !== "simple" && plan) {
    const hinted = corpusRuleHints({ prompt });
    const form = normalizeForm(plan, bars, {
      targetBars: hinted?.sectionBars ?? 6,
    });
    plan = form.plan;
  }

  // ---- (1.5) 和声の検証・補正 ----
  // creativity>=0.4で終止を分散、>=0.4でセクション境界の強制V化を半分残す (デフォルト0.5でも有効)
  // seed未指定の旧来呼び出しは従来通り (strict/authentic) のまま。rich は多様化を強制
  const useVariety =
    opts.seed !== undefined ||
    opts.creativity !== undefined ||
    complexity === "rich";
  const repaired = repairPlan(
    plan,
    bars,
    useVariety
      ? {
          seed,
          sectionCadence:
            creativity >= 0.4 || complexity === "rich" ? "loose" : "strict",
          closing:
            creativity >= 0.4 || complexity === "rich" ? "varied" : "authentic",
        }
      : {},
  );
  plan = repaired.plan;
  if (complexity === "rich")
    plan = applyReharm(
      plan,
      bars,
      (plan.timeSignature[0] * 4) / plan.timeSignature[1],
      seed,
    );
  // 和声の色付け (借用・二次ドミナント・sus4)。standard以上で、コーパス統計を尊重する
  if (complexity !== "simple" && opts.corpus !== false) {
    const strength = complexity === "rich" ? 1 : 0.8;
    const colored = colorPlan(plan, bars, seed, { strength });
    plan = colored.plan;
  }
  // ルール層にもコーパスを反映 (corpus:false でA/B計測可)
  if (opts.corpus !== false && opts.corpusRules !== false)
    plan = applyCorpusHints(plan, { prompt, dense: complexity !== "simple" });
  // 以降は確定したプランを使う (クロージャ内での絞り込みのため)
  const finalPlan: Plan = plan!;

  const beatsPerBar =
    (finalPlan.timeSignature[0] * 4) / finalPlan.timeSignature[1];
  const harmony: HarmonyLine[] = finalPlan.chords.map(([beat, symbol]) => {
    const a = analyzeChord(
      symbol,
      parseKeyName(keyAtBeat(finalPlan, beat, beatsPerBar)),
    );
    return { beat, symbol, numeral: a.numeral, fn: a.fn };
  });
  const issues = validatePlan(finalPlan, bars);
  const suggestions = reharmonizePlan(finalPlan);

  const sections = resolveSections(finalPlan, bars, beatsPerBar);

  // ---- (2) メロディ候補を並列生成して採点 (長い曲は16小節ずつ) ----
  const chunkOf = (b0: number, b1: number): MelodyContext => {
    const s0 = b0 * beatsPerBar;
    const scoped: ChordEvent[] = [];
    for (const [t, symbol] of [...finalPlan.chords].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (t < 0 || t >= s1Of(b1)) continue;
      if (t <= s0) {
        scoped.length = 0;
        scoped.push({ start: 0, symbol });
      } else scoped.push({ start: t - s0, symbol });
    }
    return {
      key: keyAtBeat(finalPlan, s0, beatsPerBar),
      chords: scoped,
      bars: b1 - b0,
      beatsPerBar,
      keyChanges: (finalPlan.keyChanges ?? [])
        .filter((kc) => kc.bar >= b0 && kc.bar < b1)
        .map((kc) => ({ bar: kc.bar - b0, key: kc.key })),
    };
  };
  const s1Of = (b1: number) => b1 * beatsPerBar;
  const ranges: { b0: number; b1: number }[] = [];
  if (bars <= CHUNK_BARS) ranges.push({ b0: 0, b1: bars });
  else
    for (let b0 = 0; b0 < bars; b0 += CHUNK_BARS)
      ranges.push({ b0, b1: Math.min(bars, b0 + CHUNK_BARS) });

  const tM = Date.now();
  const rawMelody: Note[] = [];
  let allCands: { score: number; notes: number }[] = [];
  let chosenTotal = -1;
  let chosenParts: MelodyScore["parts"] = {};
  for (const { b0, b1 } of ranges) {
    const ctx = chunkOf(b0, b1);
    // 前半チャンクで確立した verse / chorus の先頭2小節モチーフを抽出し、後半チャンクへ主題ヒントとして渡す
    const themeHints: {
      role: string;
      notes: { pitch: number; start: number; duration: number }[];
    }[] = [];
    if (b0 > 0) {
      const seenRoles = new Set<string>();
      for (const sec of sections) {
        if (
          sec.startBar >= b0 ||
          seenRoles.has(sec.role) ||
          (sec.role !== "verse" && sec.role !== "chorus")
        )
          continue;
        const motifEnd = Math.min(sec.end, sec.start + 2 * beatsPerBar);
        const mNotes = rawMelody
          .filter(
            (n) => n.start >= sec.start - 1e-4 && n.start < motifEnd - 1e-4,
          )
          .map((n) => ({
            pitch: n.pitch,
            start: n.start - sec.start,
            duration: n.duration,
          }));
        if (mNotes.length >= 2) {
          seenRoles.add(sec.role);
          themeHints.push({ role: sec.role, notes: mNotes });
        }
      }
    }
    const mMessages = melodyMessages(
      prompt,
      finalPlan,
      sections,
      bars,
      beatsPerBar,
      {
        fromBar: b0,
        toBar: b1,
        prevTail: rawMelody
          .slice(-4)
          .map((n) => ({ pitch: n.pitch, start: n.start })),
        themeHints,
      },
    );
    let cands: { notes: Note[]; score: MelodyScore }[] = [];
    for (let round = 0; round < 2 && cands.length === 0; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: nCand }, (_, i) =>
          chat(cfg, mMessages, { temperature: TEMPS[i % TEMPS.length] }),
        ),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") {
          lastError = String(r.reason);
          continue;
        }
        count(r.value.usage);
        try {
          const notes = polishMelody(
            parseCompactNotes(extractJson(r.value.content)),
            ctx,
          );
          if (notes.length >= 2)
            cands.push({ notes, score: scoreMelody(notes, ctx) });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (cands.length === 0)
      throw new Error(`Failed to write a melody: ${lastError}`);
    // seed指定時は最良固定ではなくsoftmax選択で2番手以降にも機会を与える
    const chosen = useVariety
      ? pickSoftmaxSeeded(
          cands.map((c) => c.score.total),
          rng,
          10 - creativity * 7,
        )
      : cands.reduce(
          (best, c, i) => (c.score.total > cands[best]!.score.total ? i : best),
          0,
        );
    const s0 = b0 * beatsPerBar;
    for (const n of cands[chosen]!.notes)
      rawMelody.push({ ...n, start: n.start + s0 });
    allCands = allCands.concat(
      cands.map((c) => ({ score: c.score.total, notes: c.notes.length })),
    );
    if (chosenTotal < 0 || cands[chosen]!.score.total > chosenTotal) {
      chosenTotal = cands[chosen]!.score.total;
      chosenParts = cands[chosen]!.score.parts;
    }
  }
  const isDense = complexity !== "simple" && !isCalmPrompt(prompt);
  const melody =
    complexity === "simple"
      ? rawMelody
      : developTheme(rawMelody, finalPlan, sections, beatsPerBar, {
          dense: isDense,
        });
  const melodyMs = Date.now() - tM;

  // ---- (2.5) 対旋律 (rich かつ band のとき。主旋律の隙間を埋め、主旋律より下の音域・控えめな音量に保つ) ----
  const wantCounter =
    opts.counterMelody ?? (complexity === "rich" && ensemble === "band");
  let counter: Note[] = [];
  if (wantCounter && ensemble === "band") {
    const counterAll: Note[] = [];
    for (const { b0, b1 } of ranges) {
      const ctx = chunkOf(b0, b1);
      const s0 = b0 * beatsPerBar;
      const inRange = melody
        .filter((n) => n.start >= s0 && n.start < s1Of(b1))
        .map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration }));
      if (inRange.length === 0) continue;
      const cMessages = melodyMessages(
        prompt,
        finalPlan,
        sections,
        bars,
        beatsPerBar,
        {
          fromBar: b0,
          toBar: b1,
          counterTo: inRange,
        },
      );
      const results = await Promise.allSettled(
        Array.from({ length: Math.max(1, Math.min(2, nCand - 1)) }, (_, i) =>
          chat(cfg, cMessages, { temperature: TEMPS[(i + 2) % TEMPS.length]! }),
        ),
      );
      let best: { notes: Note[]; score: MelodyScore } | undefined;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        count(r.value.usage);
        try {
          const notes = polishMelody(
            parseCompactNotes(extractJson(r.value.content)),
            ctx,
          );
          if (notes.length < 1) continue;
          const sc = scoreMelody(notes, ctx);
          if (!best || sc.total > best.score.total) best = { notes, score: sc };
        } catch {
          /* 対旋律の失敗は無視 (主旋律だけで成立させる) */
        }
      }
      if (best) {
        for (const n of best.notes) {
          const absStart = n.start + s0;
          const overlapping = melody.filter(
            (m) =>
              m.start < absStart + n.duration - 0.05 &&
              m.start + m.duration > absStart + 0.05,
          );
          const melMin =
            overlapping.length > 0
              ? Math.min(...overlapping.map((m) => m.pitch))
              : 74;
          let pitch = n.pitch;
          while (pitch > melMin - 3 && pitch - 12 >= 52) pitch -= 12;
          counterAll.push({
            ...n,
            pitch,
            start: absStart,
            velocity: Math.max(
              45,
              Math.min(72, Math.round((n.velocity ?? 75) * 0.72)),
            ),
          });
        }
      }
    }
    counter = counterAll;
  }

  const assembled = assemble(finalPlan, sections, melody, bars, {
    seed: useVariety ? seed : undefined,
    counter,
    texture: complexity !== "simple",
    arp: isDense,
    arpSixteenth: isDense,
  });

  // ---- (3) 不協和音の後処理 ----
  // 声部をまたぐ短2度/短9度を、優先度の低い声部だけ動かして解消する (旋律は不変)
  const chordEvents: ChordEvent[] = finalPlan.chords.map(([start, symbol]) => ({ start, symbol }));
  const chordTonesAt = (beat: number) => chordAt(chordEvents, beat).tones;
  const scaleTonesAt = (beat: number) => {
    const { root, scale } = parseKey(keyAtBeat(finalPlan, beat, beatsPerBar));
    return SCALES[scale]!.map((i) => (i + root) % 12);
  };
  const deduped = reduceDissonances(
    assembled.tracks.map((t) => ({ name: t.name, channel: t.channel, notes: t.notes })),
    { chordTonesAt, scaleTonesAt, maxFixes: 600 },
  );

  const score = normalizeScore(
    ScoreSchema.parse({
      ...assembled,
      tracks: deduped.tracks
        .filter((t) => t.notes.length > 0)
        .map((t) => {
          const src = assembled.tracks.find((x) => x.name === t.name);
          return { name: t.name, program: src?.program ?? 0, channel: t.channel, notes: t.notes };
        }),
    }),
    bars,
    { swing: finalPlan.swing },
  );
  return {
    score,
    midi: scoreToMidi(score),
    plan: finalPlan,
    sections: sections.map(({ name, startBar, bars: b, role }) => ({
      name,
      startBar,
      bars: b,
      role,
    })),
    attempts: planAttempts,
    harmony,
    issues,
    suggestions,
    complexity: evaluateComplexity([
      { name: finalPlan.title, bars, plan: finalPlan, score },
    ]),
    stats: {
      ms: Date.now() - t0,
      planMs,
      melodyMs,
      planAttempts,
      outputTokens,
      repairs: repaired.fixes.length,
      candidates: allCands,
      chosen: 0,
      chosenParts,
      dissonanceFixes: deduped.fixes.length,
      dissonancesRemaining: deduped.remaining.length,
    },
  };
}

