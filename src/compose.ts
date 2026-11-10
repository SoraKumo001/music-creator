import { z } from "zod";
import { chat, type ChatMessage, type LlmConfig, type Usage } from "./llm/provider";
import { scoreToMidi } from "./midi/toMidi";
import { normalizeScore } from "./normalize";
import { PlanSchema, resolveSections, type Plan, type Section } from "./plan";
import { melodyMessages, planMessages } from "./prompt";
import { NoteSchema, ScoreSchema, type Note, type Score } from "./score";
import { generateBass, generateComp, type Arrangement, type ChordEvent } from "./theory/accompaniment";
import { generateDrums } from "./theory/drums";
import { parseChord } from "./theory/harmony";
import { polishMelody, scoreMelody, type MelodyContext, type MelodyScore } from "./theory/melody";

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
export function assemble(plan: Plan, sections: Section[], melody: Note[], bars: number): Score {
  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const events: ChordEvent[] = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const a: Arrangement = { sections, totalBeats: bars * beatsPerBar, beatsPerBar };
  const tracks = [
    { name: plan.melodyName, program: plan.melodyProgram, channel: 0, notes: melody },
    { name: "Chords", program: plan.compProgram, channel: 1, notes: generateComp(events, a) },
    { name: "Bass", program: plan.bassProgram, channel: 2, notes: generateBass(events, a) },
    { name: "Drums", program: 0, channel: 9, notes: generateDrums(sections, beatsPerBar) },
  ].filter((t) => t.notes.length > 0);
  return ScoreSchema.parse({ title: plan.title, bpm: plan.bpm, timeSignature: plan.timeSignature, key: plan.key, tracks });
}

export type ComposeStats = {
  ms: number;
  planMs: number;
  melodyMs: number;
  planAttempts: number;
  outputTokens: number;
  candidates: { score: number; notes: number }[];
  chosen: number;
  chosenParts: MelodyScore["parts"];
};
export type SectionInfo = { name: string; startBar: number; bars: number };
export type ComposeResult = { score: Score; midi: Uint8Array; sections: SectionInfo[]; attempts: number; stats: ComposeStats };

export type ComposeOptions = { candidates?: number; maxAttempts?: number };

const TEMPS = [0.7, 0.9, 1.0, 0.8, 1.1];

/** プロンプト -> (1) 曲の設計 -> (2) メロディ候補を並列生成し採点で選択 -> MIDI */
export async function compose(cfg: LlmConfig, prompt: string, bars = 8, opts: ComposeOptions = {}): Promise<ComposeResult> {
  const nCand = Math.max(1, Math.min(5, opts.candidates ?? 3));
  const maxAttempts = opts.maxAttempts ?? 3;
  cfg = { ...cfg, sessionId: cfg.sessionId ?? "mc-" + crypto.randomUUID() };
  const t0 = Date.now();
  let outputTokens = 0;
  const count = (u?: Usage) => { outputTokens += u?.completion_tokens ?? 0; };

  // ---- (1) 設計 ----
  const messages: ChatMessage[] = planMessages(prompt, bars);
  let plan: Plan | undefined;
  let planAttempts = 0;
  let lastError = "";
  while (!plan && planAttempts < maxAttempts) {
    planAttempts++;
    const res = await chat(cfg, messages);
    count(res.usage);
    try {
      const p = PlanSchema.parse(extractJson(res.content));
      for (const [, sym] of p.chords) parseChord(sym); // 解釈できないコードは作り直させる
      plan = p;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      messages.push(
        { role: "assistant", content: res.content },
        { role: "user", content: `The JSON was invalid: ${lastError.slice(0, 800)}\nReturn the corrected full JSON only.` },
      );
    }
  }
  if (!plan) throw new Error(`Failed to design the song after ${maxAttempts} attempts: ${lastError}`);
  const planMs = Date.now() - t0;

  const beatsPerBar = (plan.timeSignature[0] * 4) / plan.timeSignature[1];
  const sections = resolveSections(plan, bars, beatsPerBar);
  const ctx: MelodyContext = { key: plan.key, chords: plan.chords.map(([start, symbol]) => ({ start, symbol })), bars, beatsPerBar };

  // ---- (2) メロディ候補を並列生成して採点 ----
  const mMessages = melodyMessages(prompt, plan, sections, bars, beatsPerBar);
  const tM = Date.now();
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
  const melodyMs = Date.now() - tM;
  const chosen = cands.reduce((best, c, i) => (c.score.total > cands[best]!.score.total ? i : best), 0);

  const score = normalizeScore(assemble(plan, sections, cands[chosen]!.notes, bars), bars);
  return {
    score,
    midi: scoreToMidi(score),
    sections: sections.map(({ name, startBar, bars: b }) => ({ name, startBar, bars: b })),
    attempts: planAttempts,
    stats: {
      ms: Date.now() - t0, planMs, melodyMs, planAttempts, outputTokens,
      candidates: cands.map((c) => ({ score: c.score.total, notes: c.notes.length })),
      chosen,
      chosenParts: cands[chosen]!.score.parts,
    },
  };
}
