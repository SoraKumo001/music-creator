import { z } from "zod";

/** 曲の終わり方 */
export const ENDING_STYLES = ["button", "stop", "ring", "hits"] as const;
export type EndingStyle = (typeof ENDING_STYLES)[number];

/** 編成 */
export const ENSEMBLES = ["band", "orchestra"] as const;
export type Ensemble = (typeof ENSEMBLES)[number];

/** セクションの役割 (フォーム用)。LLMが申告し、ルール層が解釈する */
export const SECTION_ROLES = [
  "intro", "verse", "prechorus", "chorus", "bridge", "break",
  "interlude", "solo", "outro", "other",
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

/** 複雑さレベル。simple=簡素、standard=現行、rich=長尺・転調・対旋律などを許す */
export const COMPLEXITIES = ["simple", "standard", "rich"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

/** 第1段階でLLMが出す「曲の設計」。音符は含まない */
export const PlanSchema = z.object({
  title: z.string().default("Untitled"),
  bpm: z.number().min(30).max(300),
  timeSignature: z.tuple([z.number().int().min(1).max(12), z.number().int().min(1)]).default([4, 4]),
  key: z.string().default("C major"),
  /** 曲中の転調。barは0始まり小節。その小節から新しい調になる */
  keyChanges: z.array(z.object({ bar: z.number().int().min(0), key: z.string().min(1) })).default([]),
  /** スウィング量 0-0.6 (ジャズ/ブルース等)。拍の後付けで適用 */
  swing: z.number().min(0).max(0.6).default(0),
  /** 省略時はテンポと調から自動で選ぶ (resolveEnding) */
  ending: z.enum(ENDING_STYLES).nullish(),
  /** ループ用の曲か (ユーザー設定。compose が上書きする) */
  loop: z.boolean().default(false),
  /** 編成 (ユーザー設定。compose が上書きする) */
  ensemble: z.enum(ENSEMBLES).default("band"),
  chords: z.array(z.tuple([z.number().min(0), z.string().min(1)])).min(1),
  sections: z
    .array(
      z.object({
        name: z.string().default("A"),
        bars: z.number().int().min(1),
        comp: z.string().default("pad"),
        bass: z.string().default("root"),
        drums: z.string().default("basic"),
        energy: z.number().min(1).max(3).default(2),
        role: z.enum(SECTION_ROLES).default("other"),
        /** 盛り上がり方向: 1=クレッシェンド、-1=デクレッシェンド、0=なし */
        swell: z.number().int().min(-1).max(1).default(0),
      }),
    )
    .default([]),
  compProgram: z.number().int().min(0).max(127).default(4),
  bassProgram: z.number().int().min(0).max(127).default(33),
  melodyProgram: z.number().int().min(0).max(127).default(0),
  melodyName: z.string().default("Melody"),
});

export type Plan = z.infer<typeof PlanSchema>;

/** 拍単位に解決したセクション */
export type Section = {
  name: string;
  startBar: number; // 0始まり
  bars: number;
  start: number; // 拍
  end: number; // 拍
  comp: string;
  bass: string;
  drums: string;
  gain: number; // ベロシティ倍率
  role: SectionRole;
  swell: -1 | 0 | 1;
};

/** セクション内の進行度 0-1 (スウェル用) */
export function sectionProgress(sec: Section, beat: number): number {
  const len = Math.max(1e-6, sec.end - sec.start);
  return Math.max(0, Math.min(1, (beat - sec.start) / len));
}

/** スウェル込みのゲイン。swell=0 なら従来の gain と同一 */
export function gainAt(sec: Section, beat: number): number {
  if (sec.swell === 0) return sec.gain;
  return sec.gain * (1 + 0.3 * sec.swell * sectionProgress(sec, beat));
}

const GAIN = (energy: number) => (energy <= 1 ? 0.82 : energy >= 3 ? 1.12 : 1);

/** LLMのセクション指定を、曲全体の小節数にぴったり合うよう整える */
export function resolveSections(plan: Plan, bars: number, beatsPerBar: number): Section[] {
  const src = plan.sections.length
    ? plan.sections
    : [{ name: "A", bars, comp: "pad", bass: "root", drums: "basic", energy: 2, role: "other" as const, swell: 0 as const }];
  const out: Section[] = [];
  let bar = 0;
  for (const s of src) {
    if (bar >= bars) break;
    const len = Math.min(s.bars, bars - bar);
    out.push({
      name: s.name, startBar: bar, bars: len, start: bar * beatsPerBar, end: (bar + len) * beatsPerBar,
      comp: s.comp, bass: s.bass, drums: s.drums, gain: GAIN(s.energy),
      role: s.role, swell: s.swell > 0 ? 1 : s.swell < 0 ? -1 : 0,
    });
    bar += len;
  }
  // 足りない分は最後のセクションを延長
  const last = out[out.length - 1]!;
  if (bar < bars) {
    last.bars += bars - bar;
    last.end = bars * beatsPerBar;
  }
  return out;
}

/** 指定拍で有効な調名。keyChanges がなければ Plan.key */
export function keyAtBeat(plan: Pick<Plan, "key" | "keyChanges">, beat: number, beatsPerBar: number): string {
  let key = plan.key;
  for (const kc of [...(plan.keyChanges ?? [])].sort((a, b) => a.bar - b.bar)) {
    if (kc.bar * beatsPerBar <= beat + 1e-9) key = kc.key;
    else break;
  }
  return key;
}

export function sectionAt(sections: Section[], beat: number): Section {
  return sections.find((s) => beat >= s.start && beat < s.end) ?? sections[sections.length - 1]!;
}

/**
 * 曲の終わり方を決める。LLM が指定していればそれを使い、
 * なければテンポと調から選ぶ（速い曲はスタブ、遅い曲は余韻）。
 */
export function resolveEnding(plan: Plan): EndingStyle {
  if (plan.ending) return plan.ending;
  if (plan.bpm >= 125) return "hits";
  if (plan.bpm <= 85) return "ring";
  const minor = /min/i.test(plan.key) || /m$/i.test(plan.key.trim());
  return minor ? "stop" : "button";
}
