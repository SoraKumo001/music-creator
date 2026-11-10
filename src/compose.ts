import { z } from "zod";
import { chat, type ChatMessage, type LlmConfig, type Usage } from "./llm/provider";
import { scoreToMidi } from "./midi/toMidi";
import { normalizeScore } from "./normalize";
import { keyAtBeat, PlanSchema, resolveEnding, resolveSections, type Complexity, type Ensemble, type Plan, type Section } from "./plan";
import { melodyMessages, planMessages } from "./prompt";
import { NoteSchema, ScoreSchema, type Note, type Score } from "./score";
import { generateBass, generateComp, type Arrangement, type ChordEvent } from "./theory/accompaniment";
import { generateDrums } from "./theory/drums";
import { parseChord } from "./theory/harmony";
import { polishMelody, scoreMelody, type MelodyContext, type MelodyScore } from "./theory/melody";
import { repairPlan } from "./theory/repair";
import { analyzeChord } from "./theory/roman";
import { parseKeyName } from "./theory/key";
import { mulberry32, pickSoftmaxSeeded, resolveSeed } from "./util/random";
import { generateOrchestra } from "./theory/orchestra";
import { reharmonizePlan, type ReharmSuggestion } from "./theory/reharmonize";
import { validatePlan, type Issue } from "./theory/validate";
import { evaluateComplexity, type ComplexitySummary } from "./eval/complexity";

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? t.slice(start, end + 1) : t);
}

/** [pitch, start, duration, velocity?] の配列形式を Note[] へ */
export function parseCompactNotes(raw: unknown): Note[] {
  const arr = (raw as { notes?: unknown })?.notes;
  if (!Array.isArray(arr)) throw new Error('expected {"notes": [[pitch,start,duration,velocity], ...]}');
  return z.array(NoteSchema).parse(
    arr.map((n) => (Array.isArray(n) ? { pitch: n[0], start: n[1], duration: n[2], ...(n[3] != null ? { velocity: n[3] } : {}) } : n)),
  );
}

/** 設計 + メロディから Score を組み立てる(伴奏・ベース・ドラムはルール層) */
export function assemble(
  plan: Plan, sections: Section[], melody: Note[], bars: number,
  opts: { seed?: number; counter?: Note[] } = {},
): Score {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  if (plan.ensemble === "orchestra") {
    const tracks = generateOrchestra(plan, sections, melody, bars, beatsPerBar);
    return ScoreSchema.parse({ title: plan.title, bpm: plan.bpm, timeSignature: plan.timeSignature, key: plan.key, tracks });
  }
  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const a: Arrangement = { sections, totalBeats: bars * beatsPerBar, beatsPerBar, ending: resolveEnding(plan), loop: plan.loop };
  const tracks = [
    { name: plan.melodyName, program: plan.melodyProgram, channel: 0, notes: melody },
    ...(opts.counter && opts.counter.length > 0
      ? [{ name: "Counter", program: plan.melodyProgram, channel: 3, notes: opts.counter }]
      : []),
    { name: "Chords", program: plan.compProgram, channel: 1, notes: generateComp(events, a, { seed: opts.seed }) },
    { name: "Bass", program: plan.bassProgram, channel: 2, notes: generateBass(events, a, { seed: opts.seed }) },
    { name: "Drums", program: 0, channel: 9, notes: generateDrums(sections, beatsPerBar, a.ending, a.loop, { seed: opts.seed }) },
  ].filter((t) => t.notes.length > 0);
  return ScoreSchema.parse({ title: plan.title, bpm: plan.bpm, timeSignature: plan.timeSignature, key: plan.key, tracks });
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
};
export type SectionInfo = { name: string; startBar: number; bars: number; role: string };
export type HarmonyLine = { beat: number; symbol: string; numeral: string; fn: "T" | "S" | "D" };
export type ComposeResult = {
  score: Score;
  midi: Uint8Array;
  sections: SectionInfo[];
  attempts: number;
  stats: ComposeStats;
  harmony: HarmonyLine[];
  issues: Issue[];
  suggestions: ReharmSuggestion[];
  complexity: ComplexitySummary;
};

export type ComposeOptions = {
  candidates?: number; maxAttempts?: number; loop?: boolean; ensemble?: Ensemble;
  /** 指定すると進行カード選択・補正・メロディ選択を決定的に分散させる */
  seed?: number;
  /** 0-1。高いほど定型を崩す (repair緩和・温度上昇・softmax選択) */
  creativity?: number;
  /** simple=簡素、standard=現行、rich=長尺・転調・対旋律などを許す */
  complexity?: Complexity;
  /** 対旋律トラックを付ける (省略時は rich かつ band のとき true) */
  counterMelody?: boolean;
};

const TEMPS = [0.7, 0.9, 1.1, 0.8, 1.3];

/** 長い曲は16小節ずつに区切ってメロディを生成する (1回のLLM出力肥大を避ける) */
const CHUNK_BARS = 16;

/** rich向け: 進行の一部を同機能の代理和音に置換して複雑化する (最大2和音、先頭・末尾2小節は除く) */
function applyReharm(plan: Plan, bars: number, beatsPerBar: number, seed: number): Plan {
  const pool = reharmonizePlan(plan).filter(
    (s) => s.beat >= 2 * beatsPerBar && s.beat < (bars - 2) * beatsPerBar,
  );
  if (pool.length === 0) return plan;
  const rand = mulberry32((seed ^ 0x3e9a6b7c) >>> 0);
  const picked = [...pool].sort(() => rand() - 0.5).slice(0, 2);
  if (picked.length === 0) return plan;
  const byBeat = new Map(picked.map((s) => {
    const alt = s.alternatives[Math.floor(rand() * s.alternatives.length)]!;
    return [s.beat, alt.symbol];
  }));
  return { ...plan, chords: plan.chords.map(([beat, sym]) => [beat, byBeat.get(beat) ?? sym] as [number, string]) };
}

/** プロンプト -> (1) 曲の設計 -> (2) メロディ候補を並列生成し採点で選択 -> MIDI */
export async function compose(cfg: LlmConfig, prompt: string, bars = 8, opts: ComposeOptions = {}): Promise<ComposeResult> {
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
  const count = (u?: Usage) => { outputTokens += u?.completion_tokens ?? 0; };

  // ---- (1) 設計 ----
  const messages: ChatMessage[] = planMessages(prompt, bars, loop, ensemble, { seed, creativity, complexity });
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
      const p = { ...PlanSchema.parse(extractJson(res.content)), loop, ensemble };
      for (const [, sym] of p.chords) parseChord(sym); // 解釈できないコードは作り直させる
      const errors = validatePlan(p, bars).filter((i) => i.severity === "error");
      if (errors.length > 0) throw new Error(errors.map((i) => `${i.code}: ${i.message}`).join(" / "));
      plan = p;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push(
        { role: "assistant", content: res.content },
        { role: "user", content: `The plan was invalid: ${lastError.slice(0, 800)}\nReturn the corrected full JSON only.` },
      );
    }
  }
  if (!plan) throw new Error(`Failed to design the song after ${maxAttempts} attempts: ${lastError}`);
  const planMs = Date.now() - t0;

  // ---- (1.5) 和声の検証・補正 ----
  // creativity>=0.5で終止を分散、>=0.6でセクション境界の強制V化を半分残す
  // seed未指定の旧来呼び出しは従来通り (strict/authentic) のまま。rich は多様化を強制
  const useVariety = opts.seed !== undefined || opts.creativity !== undefined || complexity === "rich";
  const repaired = repairPlan(plan, bars, useVariety
    ? { seed, sectionCadence: creativity >= 0.6 || complexity === "rich" ? "loose" : "strict", closing: creativity >= 0.5 || complexity === "rich" ? "varied" : "authentic" }
    : {});
  plan = repaired.plan;
  if (complexity === "rich") plan = applyReharm(plan, bars, (plan.timeSignature[0] * 4) / plan.timeSignature[1], seed);

  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const harmony: HarmonyLine[] = plan.chords.map(([beat, symbol]) => {
    const a = analyzeChord(symbol, parseKeyName(keyAtBeat(plan, beat, beatsPerBar)));
    return { beat, symbol, numeral: a.numeral, fn: a.fn };
  });
  const issues = validatePlan(plan, bars);
  const suggestions = reharmonizePlan(plan);

  const sections = resolveSections(plan, bars, beatsPerBar);

  // ---- (2) メロディ候補を並列生成して採点 (長い曲は16小節ずつ) ----
  const chunkOf = (b0: number, b1: number): MelodyContext => {
    const s0 = b0 * beatsPerBar;
    const scoped: ChordEvent[] = [];
    for (const [t, symbol] of [...plan.chords].sort((a, b) => a[0] - b[0])) {
      if (t < 0 || t >= s1Of(b1)) continue;
      if (t <= s0) { scoped.length = 0; scoped.push({ start: 0, symbol }); }
      else scoped.push({ start: t - s0, symbol });
    }
    return {
      key: keyAtBeat(plan, s0, beatsPerBar),
      chords: scoped,
      bars: b1 - b0, beatsPerBar,
      keyChanges: (plan.keyChanges ?? []).filter((kc) => kc.bar >= b0 && kc.bar < b1).map((kc) => ({ bar: kc.bar - b0, key: kc.key })),
    };
  };
  const s1Of = (b1: number) => b1 * beatsPerBar;
  const ranges: { b0: number; b1: number }[] = [];
  if (bars <= CHUNK_BARS) ranges.push({ b0: 0, b1: bars });
  else for (let b0 = 0; b0 < bars; b0 += CHUNK_BARS) ranges.push({ b0, b1: Math.min(bars, b0 + CHUNK_BARS) });

  const tM = Date.now();
  const melody: Note[] = [];
  let allCands: { score: number; notes: number }[] = [];
  let chosenTotal = -1;
  let chosenParts: MelodyScore["parts"] = {};
  for (const { b0, b1 } of ranges) {
    const ctx = chunkOf(b0, b1);
    const mMessages = melodyMessages(prompt, plan, sections, bars, beatsPerBar, {
      fromBar: b0, toBar: b1,
      prevTail: melody.slice(-4).map((n) => ({ pitch: n.pitch, start: n.start })),
    });
    let cands: { notes: Note[]; score: MelodyScore }[] = [];
    for (let round = 0; round < 2 && cands.length === 0; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: nCand }, (_, i) => chat(cfg, mMessages, { temperature: TEMPS[i % TEMPS.length] })),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") { lastError = String(r.reason); continue; }
        count(r.value.usage);
        try {
          const notes = polishMelody(parseCompactNotes(extractJson(r.value.content)), ctx);
          if (notes.length >= 2) cands.push({ notes, score: scoreMelody(notes, ctx) });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (cands.length === 0) throw new Error(`Failed to write a melody: ${lastError}`);
    // seed指定時は最良固定ではなくsoftmax選択で2番手以降にも機会を与える
    const chosen = useVariety
      ? pickSoftmaxSeeded(cands.map((c) => c.score.total), rng, 10 - creativity * 7)
      : cands.reduce((best, c, i) => (c.score.total > cands[best]!.score.total ? i : best), 0);
    const s0 = b0 * beatsPerBar;
    for (const n of cands[chosen]!.notes) melody.push({ ...n, start: n.start + s0 });
    allCands = allCands.concat(cands.map((c) => ({ score: c.score.total, notes: c.notes.length })));
    if (chosenTotal < 0 || cands[chosen]!.score.total > chosenTotal) {
      chosenTotal = cands[chosen]!.score.total;
      chosenParts = cands[chosen]!.score.parts;
    }
  }
  const melodyMs = Date.now() - tM;

  // ---- (2.5) 対旋律 (rich かつ band のとき。主旋律の隙間を埋める) ----
  const wantCounter = opts.counterMelody ?? (complexity === "rich" && ensemble === "band");
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
      const cMessages = melodyMessages(prompt, plan, sections, bars, beatsPerBar, {
        fromBar: b0, toBar: b1, counterTo: inRange,
      });
      const results = await Promise.allSettled(
        Array.from({ length: Math.max(1, Math.min(2, nCand - 1)) }, (_, i) => chat(cfg, cMessages, { temperature: TEMPS[(i + 2) % TEMPS.length]! })),
      );
      let best: { notes: Note[]; score: MelodyScore } | undefined;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        count(r.value.usage);
        try {
          const notes = polishMelody(parseCompactNotes(extractJson(r.value.content)), ctx);
          if (notes.length < 1) continue;
          const sc = scoreMelody(notes, ctx);
          if (!best || sc.total > best.score.total) best = { notes, score: sc };
        } catch { /* 対旋律の失敗は無視 (主旋律だけで成立させる) */ }
      }
      if (best) for (const n of best.notes) counterAll.push({ ...n, start: n.start + s0 });
    }
    counter = counterAll;
  }

  const score = normalizeScore(
    assemble(plan, sections, melody, bars, { seed: useVariety ? seed : undefined, counter }),
    bars,
    { swing: plan.swing },
  );
  return {
    score,
    midi: scoreToMidi(score),
    sections: sections.map(({ name, startBar, bars: b, role }) => ({ name, startBar, bars: b, role })),
    attempts: planAttempts,
    harmony,
    issues,
    suggestions,
    complexity: evaluateComplexity([{ name: plan.title, bars, plan, score }]),
    stats: {
      ms: Date.now() - t0, planMs, melodyMs, planAttempts, outputTokens, repairs: repaired.fixes.length,
      candidates: allCands,
      chosen: 0,
      chosenParts,
    },
  };
}
