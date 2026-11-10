/**
 * 解析済み MIDI コーパスのプロファイルを生成側で使う。
 * プロファイルは scripts/analyze-corpus.ts が生成する集計統計のみ。
 * 未生成 (null) の場合は何も注入しない = 従来の挙動。
 */

import { CORPUS_PROFILE } from "./corpus-profile.generated";
import type { CorpusProfile } from "../analyze/corpus";
import type { Plan } from "../plan";
import { COMP_STYLES, BASS_STYLES } from "../theory/accompaniment";
import { drumPatternPitchShares, DRUM_PATTERN_NAMES } from "../theory/drums";

export const corpusProfile: CorpusProfile | null = CORPUS_PROFILE;

export function hasCorpusProfile(): boolean {
  return corpusProfile !== null;
}

/**
 * コーパス統計からルール層の具体的なパラメータを導く。
 * プロンプトでは動かせない部分 (ドラムパターン・伴奏スタイル・音色の既定値) を
 * データに合わせるためのアダプタ。
 */
export type CorpusRuleHints = {
  /** コーパスのドラム構成に近いパターン名 (近い順) */
  drumPatterns: string[];
  /** コーパスの細分性に合う comp スタイル (近い順) */
  compStyles: string[];
  /** bass スタイル (近い順) */
  bassStyles: string[];
  /** 楽器構成に合わせた既定プログラム */
  programs: { comp: number; bass: number; melody: number };
  /** セクション長の既定値 (小節) */
  sectionBars: number;
};

const FAMILY_PROGRAM: Record<string, number> = {
  piano: 0, chromatic: 9, organ: 19, guitar: 29, bass: 33, strings: 48,
  ensemble: 52, brass: 61, reed: 71, synthLead: 81, synthPad: 89, synthFx: 96, percussive: 112,
};

const cos = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

/** コーパスのドラム音別の出現比 */
function corpusDrumShares(p: CorpusProfile): Record<string, number> {
  return p.drums;
}

export function corpusRuleHints(opts: CorpusHintOptions = {}): CorpusRuleHints | null {
  const p = corpusProfile;
  if (!p) return null;

  // --- ドラム: コーパスの GM 音別の出現比に最も近いパターンを上位に ---
  const target = corpusDrumShares(p);
  const targetKeys = Object.keys(target);
  const patternShares = drumPatternPitchShares();
  const drumPatterns = [...DRUM_PATTERN_NAMES]
    .map((name) => {
      const shares = patternShares[name] ?? {};
      // 比較はコーパスに出現する音の集合で行う (パターンに無い音は0)
      const a = targetKeys.map((k) => target[k] ?? 0);
      const b = targetKeys.map((k) => shares[k] ?? 0);
      const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
      const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
      const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
      return { name, score: na === 0 || nb === 0 ? 0 : dot / (na * nb) };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.name);

  // --- comp: 細分性に合わせる (16分が多い→刻む、ダウンビート多い→ブロック) ---
  const r = p.rhythm;
  const compScore: Record<string, number> = {
    arpeggio: r.sixteenthShare * 1.2 + r.offGridShare * 0.5,
    syncopation: r.sixteenthShare * 1.1 + r.offbeat8thShare * 1.2,
    offbeat: r.offbeat8thShare * 1.4,
    strum: r.offbeat8thShare * 0.8 + r.downbeatShare * 0.6,
    block: r.downbeatShare * 1.5,
    pad: r.downbeatShare * 0.8,
  };
  // arpeggio16 は16分割で刻むスタイル。dense 指定時は優先する
  if (opts.dense) compScore.arpeggio16 = (compScore.arpeggio16 ?? 0) + 2;
  const compStyles = [...COMP_STYLES].sort((a, b) => (compScore[b] ?? 0) - (compScore[a] ?? 0));

  // --- bass: 細分性が高ければ刻む/動く、低ければルート中心 ---
  const bassScore: Record<string, number> = {
    eighths: r.sixteenthShare * 1.3 + r.offbeat8thShare * 0.5,
    walking: r.offGridShare * 1.2 + r.offbeat8thShare * 0.4,
    rootFifth: r.downbeatShare * 1.2,
    root: r.downbeatShare * 1.5,
    pedal: r.downbeatShare * 0.7,
  };
  const bassStyles = [...BASS_STYLES].sort((a, b) => (bassScore[b] ?? 0) - (bassScore[a] ?? 0));

  // --- 音色: コーパスの上位ファミリーを既定プログラムへ ---
  // comp (和音) はジャンル優先順を尊重し、コーパスでの存在感を従属的に使う
  const share = (f: string) => p.instruments[f] ?? 0;
  /** 優先順の先頭から、コーパスに一定量存在するものを選ぶ */
  const pickFamily = (order: string[]): string => order.find((f) => share(f) >= 0.02) ?? order[0]!;
  const compFamily = pickFamily(compFamilyOrder(opts.prompt));
  const melodyFamily = pickFamily(melodyFamilyOrder(opts.prompt));
  const programs = {
    comp: FAMILY_PROGRAM[compFamily] ?? 4,
    bass: FAMILY_PROGRAM.bass ?? 33,
    melody: FAMILY_PROGRAM[melodyFamily] ?? 0,
  };

  return {
    drumPatterns,
    compStyles,
    bassStyles,
    programs,
    sectionBars: Math.max(2, Math.round(p.form.medianSectionBars || 4)),
  };
}

/**
 * プロンプトへ差し込む「観測された傾向」ブロック。
 * 生成側の自由度を保つため、数値は目安として提示し、強い制約にはしない。
 */
export function corpusGuidance(): string {
  const p = corpusProfile;
  if (!p) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push("");
  lines.push(
    "Observed tendencies in a reference corpus of game-music MIDI arrangements " +
    "(statistics only; do not copy any specific piece). Use them as a style prior, not a rule:",
  );
  for (const insight of p.insights) lines.push(`- ${insight}`);
  if (p.harmony.topBigrams.length > 0) {
    lines.push(
      `- Prefer smooth functional moves seen in the corpus (${p.harmony.topBigrams
        .slice(0, 4)
        .map((b) => b.pair.replace(">", "→"))
        .join(", ")}); still avoid D→S retrogression.`,
    );
  }
  lines.push(
    "- You may deviate from these priors when the user asks for something different.",
  );
  return lines.join("\n");
}

/** コーパスのテンポ帯 (プロンプト内の数値整合に使う) */
export function corpusTempoRange(): { min: number; max: number; median: number } | null {
  if (!corpusProfile) return null;
  return { min: corpusProfile.tempo.p10, max: corpusProfile.tempo.p90, median: corpusProfile.tempo.median };
}

/** コーパスで優勢な拍子 (例 "4/4") */
export function corpusTopMeter(): string | null {
  if (!corpusProfile) return null;
  const top = Object.entries(corpusProfile.meters).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

/**
 * リクエストのジャンルに応じた comp 用の音色ファミリー優先順。
 * コーパスの統計だけでは「ピアノ曲」にリード音色を選んでしまうため、プロンプトで補正する。
 */
function compFamilyOrder(prompt?: string): string[] {
  const p = (prompt ?? "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => p.includes(k));
  if (has("クラシック", "ピアノ", "classical", "piano", "バラード", "ballad", "しっとり", "静か")) {
    return ["piano", "strings", "chromatic", "guitar", "synthPad", "synthLead"];
  }
  if (has("ロック", "rock", "バンド", "ギター", "guitar", "punk", "メタル")) {
    return ["guitar", "piano", "organ", "synthPad", "synthLead"];
  }
  if (has("edm", "dance", "ダンス", "エレクトロ", "techno", "ゲーム", "game", "チップ", "8bit", "chiptune")) {
    return ["synthLead", "synthPad", "chromatic", "piano", "guitar"];
  }
  if (has("ジャズ", "jazz", "シティポップ", "citypop", "ローファイ", "lofi", "チル", "chill")) {
    return ["piano", "chromatic", "guitar", "synthPad", "strings"];
  }
  // 既定: コーパスの上位ファミリーをそのまま尊重する
  return ["synthLead", "piano", "guitar", "synthPad", "organ", "strings", "ensemble", "reed", "brass", "chromatic"];
}

export type CorpusHintOptions = {
  prompt?: string;
  /** true なら 16 分主体の comp を優先する (standard 以上の complexity) */
  dense?: boolean;
};

/** 静か・ローファイ・バラード・ピアノ独奏など、過密な16分刻みを強制すべきでないプロンプトか判定 */
export function isCalmPrompt(prompt?: string): boolean {
  const p = (prompt ?? "").toLowerCase();
  const calmKeys = ["静か", "ローファイ", "lofi", "lo-fi", "チル", "chill", "バラード", "ballad", "しっとり", "クラシック", "classical", "アンビエント", "ambient"];
  const energeticKeys = ["疾走", "バトル", "戦闘", "ロック", "rock", "edm", "ダンス", "アップテンポ", "ゲーム", "game", "ボス"];
  if (energeticKeys.some((k) => p.includes(k))) return false;
  return calmKeys.some((k) => p.includes(k));
}

/** メロディ用音色のジャンル別優先順 */
function melodyFamilyOrder(prompt?: string): string[] {
  const p = (prompt ?? "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => p.includes(k));
  if (has("クラシック", "ピアノ", "classical", "piano", "バラード", "ballad", "しっとり", "静か")) {
    return ["piano", "strings", "reed", "chromatic", "guitar", "synthLead"];
  }
  if (has("ロック", "rock", "バンド", "ギター", "guitar", "punk", "メタル")) {
    return ["guitar", "synthLead", "brass", "piano"];
  }
  if (has("edm", "dance", "ダンス", "エレクトロ", "techno", "ゲーム", "game", "チップ", "8bit", "chiptune")) {
    return ["synthLead", "synthPad", "chromatic", "piano"];
  }
  if (has("ジャズ", "jazz", "シティポップ", "citypop", "ローファイ", "lofi", "チル", "chill")) {
    return ["piano", "chromatic", "guitar", "reed", "synthLead"];
  }
  return ["synthLead", "piano", "guitar", "strings", "reed", "brass", "chromatic"];
}

/**
 * LLM が既定値のままにした項目へ、コーパス統計から導いた値を適用する。
 * 明示的に選ばれた値は尊重する (スキーマ既定値と一致する場合のみ置換)。
 * 決定論的なので、A/B の効果測定にも使える。
 */
export function applyCorpusHints(plan: Plan, opts: CorpusHintOptions = {}): Plan {
  const hints = corpusRuleHints(opts);
  if (!hints) return plan;

  const next: Plan = {
    ...plan,
    // PlanSchema の既定値 (comp=4, bass=33, melody=0) と一致する場合のみ置換する
    compProgram: plan.compProgram === 4 ? hints.programs.comp : plan.compProgram,
    bassProgram: plan.bassProgram === 33 ? hints.programs.bass : plan.bassProgram,
    melodyProgram: plan.melodyProgram === 0 ? hints.programs.melody : plan.melodyProgram,
  };

  // オーケストラは comp/bass/drums を参照しない
  if (plan.ensemble === "orchestra") return next;

  // セクション内のスタイルも「既定値のときだけ」コーパスの傾向へ寄せる
  // 既定値: comp="pad", bass="root", drums="basic"
  const drumFor = (energy: number): string => {
    if (energy <= 1) {
      // 静かなセクションは控えめなパターンを残す
      const sparse = hints.drumPatterns.find((d) => d === "halftime" || d === "lofi");
      if (sparse) return sparse;
    }
    return hints.drumPatterns[0] ?? "basic";
  };
  const hinted = plan.sections.map((s) => {
    // rich/dense では「16分で刻む」参照コーパスの性格に寄せる。
    // ただし LLM が明確に選んだスタイル (刻む系) は尊重し、持続系のみ置換する。
    const sustainedComp = s.comp === "pad" || s.comp === "block";
    const sustainedBass = s.bass === "root" || s.bass === "rootFifth";
    const denseSection = opts.dense === true && !isCalmPrompt(opts.prompt) && s.energy >= 2;
    return {
      ...s,
      comp: s.comp === "pad" ? hints.compStyles[0] ?? s.comp : denseSection && sustainedComp ? "arpeggio16" : s.comp,
      bass: s.bass === "root" ? hints.bassStyles[0] ?? s.bass : denseSection && sustainedBass ? "sixteenths" : s.bass,
      drums: s.drums === "basic" ? drumFor(s.energy) : s.drums,
    };
  });

  if (hinted.length > 0) {
    next.sections = hinted;
  } else {
    // セクション指定がない場合はコーパスの中央的な長さで1つ作る
    next.sections = [{
      name: "A",
      bars: hints.sectionBars,
      comp: hints.compStyles[0] ?? "pad",
      bass: hints.bassStyles[0] ?? "root",
      drums: drumFor(2),
      energy: 2,
      role: "other",
      swell: 0,
    }];
  }
  return next;
}



