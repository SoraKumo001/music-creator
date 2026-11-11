import { pickGenreCards } from "./knowledge/genres";
import { corpusGuidance, corpusProfile } from "./knowledge/corpus";
import { webKnowledgeGuidance } from "./knowledge/web-knowledge";
import {
  PROGRESSIONS,
  progressionById,
  type ProgressionCard,
} from "./knowledge/progressions";
import type { ChatMessage } from "./llm/provider";
import {
  SECTION_ROLES,
  type Complexity,
  type Ensemble,
  type Plan,
  type Section,
} from "./plan";
import { BASS_STYLES, COMP_STYLES } from "./theory/accompaniment";
import { DRUM_PATTERN_NAMES } from "./theory/drums";
import type { Mode } from "./theory/key";
import { realizeNumerals } from "./theory/roman";
import { hashSeed, mulberry32, sampleSeeded } from "./util/random";
import { isCalmPrompt } from "./knowledge/corpus";

const list = (a: readonly string[]) => a.map((n) => `"${n}"`).join(", ");

/** ジャンルに合う進行カード。seedで選択と提示順をローテーションする (毎回同じカード・同じ並びにしない) */
function progressionCards(
  userPrompt: string,
  seed?: number,
  mode?: Mode,
): ProgressionCard[] {
  const ids: string[] = [];
  for (const genre of pickGenreCards(userPrompt))
    for (const id of genre.progressions ?? []) if (!ids.includes(id)) ids.push(id);
  const cards = ids.flatMap((id) => {
    const card = progressionById(id);
    return card ? [card] : [];
  });
  // 生成するモードが決まっている場合は、そのモードの進行カードだけを見せる。
  // (長調の曲に短調の定番カードを渡すと、キーだけ長調で中身が短調の進行が書かれる)
  if (mode) {
    const rand = mulberry32((seed ?? hashSeed(userPrompt)) ^ 0x3c6ef372);
    const sameMode = cards.filter((c) => c.mode === mode);
    // ジャンル内にそのモードのカードが足りなければ、全体から同モードのカードで補って
    // 最低3枚は提示する (2枚以下だと選択肢が乏しく、同じ進行の反復になりやすい)
    const need = Math.max(0, 3 - sameMode.length);
    const extra = PROGRESSIONS.filter((c) => c.mode === mode && !sameMode.includes(c));
    const topped = sameMode.concat(sampleSeeded(extra, Math.min(need, 4 - sameMode.length), rand));
    const pool = topped.length > 0 ? topped : cards;
    if (pool.length > 0) return sampleSeeded(pool, Math.min(4, pool.length), rand);
  } else if (cards.length > 0) {
    // 同じプロンプトでも seed ごとに「どのカードを出すか・並び順」を変える
    const rand = mulberry32((seed ?? hashSeed(userPrompt)) ^ 0x3c6ef372);
    return sampleSeeded(cards, Math.min(4, cards.length), rand);
  }
  // フォールバック: 全カードから決定的サンプル。seed未指定でもpromptハッシュで揺らす
  const rand = mulberry32(seed ?? hashSeed(userPrompt));
  const all = mode ? PROGRESSIONS.filter((c) => c.mode === mode) : PROGRESSIONS;
  return sampleSeeded(all.length >= 2 ? all : PROGRESSIONS, 5, rand);
}

/** 世代ごとにキー・テンポ・進行の選択をずらす指示 (同じプロンプトの反復で同一化しない) */
const TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** リクエストが「長調/短調」を明示しているか (雰囲気語より優先する) */
const EXPLICIT_MINOR = /短調|マイナー|\bminor\b/i;
const EXPLICIT_MAJOR = /長調|メジャー|\bmajor\b/i;

/**
 * リクエストが明示している雰囲気 (暗い/明るい)。
 * 「ボス戦」「疾走」のような盛り上がり系はどちらの雰囲気にもなり得るため、
 * ここでは「明るい・楽しい・勇ましい」「暗い・悲しい」を名指ししたときだけモードを決め打つ。
 */
const MINOR_MOOD =
  /短調|マイナー|暗い|暗黒|ダーク|悲し|哀し|哀愁|切な|寂し|孤独|絶望|恐怖|ホラー|戦慄|緊張|陰鬱|沈痛|涙|別れ|喪失|\b(?:dark(?:er|ness)?|sad(?:ness)?|sorrowful|somber|gloomy|tragic|melancholy|melancholic|horror|ominous|eerie|sinister|noir|brooding|haunting)\b/;
const MAJOR_MOOD =
  /長調|メジャー|明る|楽し|元気|勇まし|勇気|爽快|希望|ヒーロー|勇者|勝利|栄光|派手|ハッピー|陽気|軽快|かわい|可愛|にぎやか|青春|輝|\b(?:bright(?:er|ness)?|happ(?:y|iness)|joyful|cheerful|heroic|triumph(?:ant)?|hopeful|upbeat|sunny|festive|playful|energetic|glorious|uplifting)\b/;

export type PickModeOptions = {
  /** false にするとコーパス比率を使わず 50/50 で引く (コーパスA/B計測用) */
  corpusPrior?: boolean;
};

/**
 * この生成で使うモード (長調/短調) を決める。
 *
 * 以前は LLM に任せていたが、ゲーム/戦闘/疾走系のリクエストでは
 * ほぼ毎回短調が選ばれていた (参照コーパスは長調 53% / 短調 48% のほぼ半々)。
 * - 「短調で」「長調の」など明示されていればそれに従う
 * - 次に「明るい/暗い」等の雰囲気語に従う
 * - どちらも無ければ参照コーパスの比率 (modeShare) を seed 付き乱数で引く
 * 決定的なので、同じ seed + プロンプトなら常に同じモードになる。
 */
export function pickMode(userPrompt: string, seed: number, opts: PickModeOptions = {}): Mode {
  const p = userPrompt.toLowerCase();
  const explicitMinor = EXPLICIT_MINOR.test(p);
  const explicitMajor = EXPLICIT_MAJOR.test(p);
  if (explicitMinor !== explicitMajor) return explicitMinor ? "minor" : "major";
  const wantsMinor = MINOR_MOOD.test(p);
  const wantsMajor = MAJOR_MOOD.test(p);
  if (wantsMinor !== wantsMajor) return wantsMinor ? "minor" : "major";
  const majorShare = opts.corpusPrior === false ? 0.5 : (corpusProfile?.modeShare.major ?? 0.5);
  const rand = mulberry32((seed ^ 0x1d872b41) >>> 0);
  return rand() < majorShare ? "major" : "minor";
}

/** ジャンルカードの "Tempo 70-90 BPM" から実際のテンポ帯を取り出す */
function tempoRangeOf(genreCards: { card: string }[], fallbackCards: ProgressionCard[]): [number, number] {
  const ranges = genreCards
    .map((c) => /Tempo\s+(\d{2,3})\s*[-–]\s*(\d{2,3})\s*BPM/i.exec(c.card))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  if (ranges.length > 0) {
    return [Math.max(...ranges.map((r) => r[0])), Math.min(...ranges.map((r) => r[1]))];
  }
  if (fallbackCards.length > 0) {
    return [
      Math.min(...fallbackCards.map((c) => c.tempo[0])),
      Math.max(...fallbackCards.map((c) => c.tempo[1])),
    ];
  }
  return [90, 145];
}

function variationBlock(
  seed: number,
  cards: ProgressionCard[],
  genreCards: { card: string }[],
  userPrompt: string,
  mode: Mode,
): string {
  const rand = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const tonic = TONICS[Math.floor(rand() * TONICS.length)]!;
  const [lo, hi] = tempoRangeOf(genreCards, cards);
  const span = Math.max(0, hi - lo);
  // 静かな曲は低め、明るい/元気な曲は高めへ寄せつつ、seedで毎回ずらす
  const p = userPrompt.toLowerCase();
  const bright = /明る|楽しい|元気|にぎやか|ポップ|アニメ|アイドル|青春|happy|bright|upbeat|energetic/.test(p);
  const calm = isCalmPrompt(userPrompt);
  const center = calm
    ? lo + rand() * span * 0.45
    : bright
      ? lo + span * 0.5 + rand() * span * 0.5
      : lo + rand() * span;
  const bpm = Math.max(40, Math.min(200, Math.round(center)));
  const opposite = mode === "major" ? "minor" : "major";
  return `\n\nVariation for this generation (follow it):
- Key: use exactly ${tonic} ${mode} — make this the song's main key and keep this mode throughout (no transposition, no switch to the ${opposite} mode). If the complexity guidance allows a modulation, modulate to another key of the same mode.
- Tempo: about ${bpm} BPM.
- For the A section, do not pick the most obvious default skeleton of this style: avoid I–V–vi–IV, Imaj7–vi7–ii7–V7, IV–V–iii–vi and vi–IV–I–V unless the request names them. Choose a less common skeleton from the vocabulary above, and a different one (or a clear variation) for the B section. Keep the tonic (I/i) as the audible home chord so the mode you were given is what the listener hears.`;
}

function progressionLine(card: ProgressionCard): string {
  const exampleKey = card.mode === "major" ? "C major" : "A minor";
  const example = realizeNumerals(card.numerals, exampleKey).join("–");
  const rhythm = `${card.harmonicRhythm} chord${card.harmonicRhythm > 1 ? "s" : ""}/bar`;
  return `- ${card.name} [${card.id}] ${card.numerals.join("–")} (${card.bars} bars, ${rhythm}). Example in ${exampleKey}: ${example}. Feel: ${card.feel}. Use: ${card.usage}`;
}

function progressionBlock(cards: ProgressionCard[]): string {
  return `\n\nProgression vocabulary — choose ONE as the skeleton for the A section, and a different one (or a variation) for the B section:
${cards.map(progressionLine).join("\n")}

Harmony rules:
- Keep each skeleton's roman numerals and repeat the 4-bar skeleton across an 8-bar section (or repeat the same progression when verse/chorus returns) so the listener hears a clear, recurring harmonic theme. You may substitute at most one chord per section, and only for a chord with the same function.
- In a major key keep the tonic audible as home: state I early and at phrase ends, and do not let vi or iii dominate the loop — a vi-heavy loop sounds like its relative minor, not major.
- Write the chords as actual symbols in your chosen key, not as roman numerals.
- Put chord changes on whole beats, 1–2 per bar, and keep the skeleton's harmonic rhythm.
- End each section with a cadence (V–I, IV–I, or V–vi); the song must end on the tonic.
- Follow T -> S -> D -> T; avoid D -> S (for example V -> IV) unless the style needs it.`;
}

const PLAN_SYSTEM = `You are a professional composer and arranger. Output ONLY one compact JSON object (no markdown) that designs a song.
Do NOT write any notes. The accompaniment is generated automatically from your chords and section styles, and the melody is written in a later step.

Schema:
{
  "title": string,
  "bpm": number,
  "timeSignature": [numerator, denominator],
  "key": string (the key and mode, e.g. "C major", "A minor", "F# minor", "Bb major"),
  "keyChanges": [{ "bar": 0-based bar number, "key": string }] (optional, for modulation),
  "swing": number 0-0.6 (optional, 0.2-0.35 for jazz/blues/shuffle feel),
  "ending": one of "button", "stop", "ring", "hits" (optional),
  "chords": [[startBeat, "Symbol"], ...],
  "sections": [{ "name": string, "bars": integer, "role": one of ${list(SECTION_ROLES)}, "comp": one of ${list(COMP_STYLES)}, "bass": one of ${list(BASS_STYLES)}, "drums": one of ${list(DRUM_PATTERN_NAMES)}, "none", "energy": 1 | 2 | 3, "swell": -1 | 0 | 1 }],
  "compProgram": GM instrument 0-127 for the chords,
  "bassProgram": GM instrument 0-127 for the bass,
  "melodyProgram": GM instrument 0-127 for the melody,
  "melodyName": string
}

Details:
- "chords": cover the whole song from beat 0, one entry per chord change (usually 1 or 2 per bar). A quarter note = 1 beat; bar n starts at (n-1) * beatsPerBar. Symbols: C, Cm, C7, Cmaj7, Cm7, Cm7b5, Cdim, Csus4, C6, C9, Cadd9, optional slash bass (C/E). Flats/sharps as Bb, F#.
- "key" & mode (important): match the mode to the request and the reference corpus. Bright, happy, heroic or upbeat requests are usually major; dark, sad or tense requests are minor. Do not default to minor — the reference corpus mixes both modes. When the Variation block names a key, use exactly that key and mode.
- "timeSignature": usually [4,4]. You may use [3,4] for a waltz or [6,8] for a compound feel when the request suits it.
- "sections": in order; their "bars" must add up to the requested length. Give the song a shape with "role": e.g. intro (energy 1, drums "none"), verse (energy 2), prechorus (energy 2-3, "swell" 1), chorus (energy 3), bridge (contrast key or feel), break (only melody + sparse hits), outro. For short songs (4-8 bars) use 2-3 sections; for 16+ bars use 4-6 with a chorus and a contrasting bridge or break. "swell" 1 builds up into the next section.
- Vary "comp", "bass" and "drums" between sections so the arrangement develops; do not use identical drum or accompaniment settings for every section (e.g. use "none" or "halftime" in intro/bridge, steady groove like "rock"/"lofi"/"corpus3" in verse, and high-drive "game16th"/"fourOnFloor"/"corpus7"/"corpus8" in chorus).
- "ending": choose the ending that fits the request. "button" = two short hits (pop); "stop" = one short hit then silence (rock/punk); "ring" = let the final chord ring out (ballad/lofi); "hits" = four stabs (dance/rock). Do not always use "button"; match the genre and mood. Omit it only if unsure (the app then derives one from tempo and key).
- Use 4-6 different chords. Use a different progression for the B/chorus section than for A.
- Variety (important — every generation must sound different): avoid the default C major / 120 BPM / I–V–vi–IV unless the request asks for it. Pick a key, tempo and borrowed/secondary-dominant color that fits the mood. Use at least one of: inversion (C/E), tension (maj7/9/add9), or borrowing (iv, bVI, bVII) where it fits the style.`;

export type PlanPromptOptions = {
  seed?: number;
  creativity?: number;
  complexity?: Complexity;
  /** false にするとコーパス由来の知見を注入しない (A/B 計測用。既定は注入する) */
  corpus?: boolean;
  /** false にするとWeb由来の知識カードを注入しない (A/B 計測用。既定は注入する) */
  web?: boolean;
};

function complexityBlock(
  bars: number,
  complexity: Complexity = "standard",
): string {
  if (complexity === "simple") {
    return `\n\nSimplicity: keep the song simple — at most 2 sections, diatonic chords only, no keyChanges, swing 0.`;
  }
  if (complexity === "rich" || bars >= 16) {
    const sectionHint =
      bars >= 24
        ? `\n- Section structure & thematic return: use 4–8 bar sections and bring back "verse" or "chorus" at least twice (e.g. intro -> verse -> chorus -> bridge -> chorus) with the same chord progression so the main theme recurs clearly.`
        : "";
    return `\n\nAmbition (longer song): use 4-6 sections with distinct roles including a chorus and a bridge or break.${sectionHint}
- keyChanges: for 16+ bars you MAY modulate once (e.g. up a whole step for the final chorus, or to a closely related key for the bridge). List at most 2 entries; the first bar is 0. End the song in the final key.
- Contrast the bridge: different feel, sparser texture, or a new borrowed color; build back with prechorus "swell" 1.`;
  }
  return "";
}

export function planMessages(
  userPrompt: string,
  bars: number,
  loop = false,
  ensemble: Ensemble = "band",
  opts: PlanPromptOptions = {},
): ChatMessage[] {
  // コーパス比率を使うかは注入設定に合わせる (corpus:false のA/Bでも完全に切れるように)
  const corpusPrior = opts.corpus !== false;
  // seed 指定時 (= 実生成) はモードをここで決め、進行カードと Variation ブロックを揃える
  const mode = opts.seed !== undefined ? pickMode(userPrompt, opts.seed, { corpusPrior }) : undefined;
  const progc = progressionCards(userPrompt, opts.seed, mode);
  const cards = pickGenreCards(userPrompt);
  const knowledge = cards.length
    ? "\n\nGenre guidance:\n" +
      cards.map((c) => `- [${c.id}] ${c.card}`).join("\n")
    : "";
  const endingRule = loop
    ? `

This song will be LOOPED. The last bar is a turnaround, not an ending:
- Write the progression so the last bar leads back to the first chord: end on V (or V7), or a turnaround such as ii-V. Do not finish with a final tonic cadence.
- Start the progression on the tonic so that V resolves into the loop point.
- The "ending" field is ignored in loop mode; keep the harmonic rhythm steady across the loop point.`
    : `

- End with a cadence that resolves to the tonic chord in the final bar.`;
  const ensembleRule =
    ensemble === "orchestra"
      ? `

The arrangement will be ORCHESTRAL (strings, woodwinds, brass, timpani, harp). Focus on chords, sections and the melody; "comp", "bass" and "drums" styles are ignored. Use energy 1 for intimate passages and energy 3 for the full tutti.`
      : "";
  return [
    {
      role: "system",
      content:
        PLAN_SYSTEM +
        knowledge +
        progressionBlock(progc) +
        (mode !== undefined ? variationBlock(opts.seed!, progc, cards, userPrompt, mode) : "") +
        (opts.corpus === false ? "" : corpusGuidance()) +
        (opts.web === false
          ? ""
          : webKnowledgeGuidance(userPrompt, undefined, 2, {
              context: { bars, complexity: opts.complexity, ensemble },
            })) +
        complexityBlock(bars, opts.complexity) +
        endingRule +
        ensembleRule,
    },
    { role: "user", content: `Request: ${userPrompt}\nLength: ${bars} bars.` },
  ];
}

const MELODY_SYSTEM = `You are a professional melody writer. Output ONLY one compact JSON object (no markdown): {"notes":[[pitch,start,duration,velocity],...]}
Each note is [MIDI note number, start in beats from the beginning of the song, duration in beats, velocity 1-127]. A quarter note = 1 beat.

Rules:
- Single-line melody (no simultaneous notes), spanning MIDI 60-88.
- On strong beats (first and middle beat of a bar) and on long notes, use tones of the current chord. Use scale tones as passing notes between them.
- Thematic motif & hook (essential): build each section around an unmistakable 2-bar melodic motif (a distinctive rhythm + interval hook). State the motif in bars 1-2 of the section, repeat it in bars 3-4 transposed to fit the chord change (A -> A'), then develop or answer it in the next bars (B -> A''). When a section role (such as verse or chorus) returns later in the song, bring back its main motif so the song has a memorable theme.
- Register contrast & climax: place verse/intro melodies in the mid register (MIDI 62-76) and lift chorus/climax melodies into the high register (MIDI 72-86) with a clear peak note. Mix stepwise motion with expressive hook leaps (4th, 5th, 6th, octave).
- Active melodic drive & phrasing: write 5-8 notes per bar in energetic sections (or 3-5 in slow/calm sections). End 2-bar or 4-bar phrases with a concise breath rest of 0.5-1 beat on the final beat of the phrase so the melody breathes without feeling sparse or empty.
- Mix note lengths (sixteenths, eighths, dotted eighths, quarters), use syncopation across beats, and lock into the groove.
- Follow the section energy: sparse or silent in energy 1 sections, most active and highest in energy 3 sections.
- Velocity dynamics: vary velocity naturally (75-118). Give peak and accented hook notes strong velocity (100-118) and softer touches (72-85) to pickup/passing notes. Do not output constant velocity.`;

export type MelodyPromptOptions = {
  /** この範囲の小節だけ書く (0始まり、toBarは含まない)。長い曲の分割生成用 */
  fromBar?: number;
  toBar?: number;
  /** 直前フレーズの末尾 (継続性のため)。{pitch, start} の最大4音 */
  prevTail?: { pitch: number; start: number }[];
  /** 前半で確立した主題モチーフ (セクション再登場時の主題再現用) */
  themeHints?: {
    role: string;
    notes: { pitch: number; start: number; duration: number }[];
  }[];
  /** 対旋律用: 主旋律のこの範囲の音 (pitch,start)。指定時は対旋律の指示に切替 */
  counterTo?: { pitch: number; start: number; duration: number }[];
};

export function melodyMessages(
  userPrompt: string,
  plan: Plan,
  sections: Section[],
  bars: number,
  beatsPerBar: number,
  opts: MelodyPromptOptions = {},
): ChatMessage[] {
  const fromBar = opts.fromBar ?? 0;
  const toBar = opts.toBar ?? bars;
  const offset = fromBar * beatsPerBar;
  const chordLines: string[] = [];
  const sorted = [...plan.chords].sort((a, b) => a[0] - b[0]);
  for (let b = fromBar; b < toBar; b++) {
    const s = b * beatsPerBar;
    const e = s + beatsPerBar;
    const inBar = sorted.filter(([t]) => t >= s && t < e);
    const carry = [...sorted].reverse().find(([t]) => t <= s);
    const parts =
      inBar.length && inBar[0]![0] === s
        ? inBar
        : [...(carry ? [[s, carry[1]] as [number, string]] : []), ...inBar];
    chordLines.push(
      `bar ${b + 1} (beats ${s - offset}-${e - offset}): ` +
        parts.map(([t, sym]) => `${sym}@${t - offset}`).join(" "),
    );
  }
  const sectionLines = sections.map(
    (s) =>
      `- ${s.name} (${s.role}): bars ${s.startBar + 1}-${s.startBar + s.bars}, energy ${s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2}${s.swell !== 0 ? `, swell ${s.swell > 0 ? "up" : "down"}` : ""}`,
  );
  const user = [
    `Song request: ${userPrompt}`,
    `Title: ${plan.title}`,
    `Key: ${plan.key}, tempo ${plan.bpm} BPM, time signature ${plan.timeSignature.join("/")}, ${bars} bars (${bars * beatsPerBar} beats).`,
    ...(fromBar > 0 || toBar < bars
      ? [
          `Range: write ONLY bars ${fromBar + 1}-${toBar} (beats 0-${(toBar - fromBar) * beatsPerBar} relative to bar ${fromBar + 1}). Do not write notes outside this range.`,
        ]
      : []),
    ...(opts.prevTail && opts.prevTail.length > 0
      ? [
          `Previous phrase ends with: ${opts.prevTail.map((n) => `${n.pitch}@${n.start - offset}`).join(" ")}. Start this phrase as a natural continuation.`,
        ]
      : []),
    ...(opts.themeHints && opts.themeHints.length > 0
      ? [
          `Established section motifs (reuse/adapt the matching motif when the same section role returns so the main theme is unmistakable):\n` +
            opts.themeHints
              .map(
                (h) =>
                  `- ${h.role} motif (pitch@beat+dur): ${h.notes.map((n) => `${n.pitch}@${Math.round(n.start * 4) / 4}+${Math.round(n.duration * 4) / 4}`).join(" ")}`,
              )
              .join("\n"),
        ]
      : []),
    ...(opts.counterTo
      ? [
          `Main melody in this range (pitch@start): ${opts.counterTo.map((n) => `${n.pitch}@${n.start - offset}`).join(" ")}.`,
        ]
      : []),
    `Sections:\n${sectionLines.join("\n")}`,
    `Chords:\n${chordLines.join("\n")}`,
    opts.counterTo ? "Write the counter-melody." : "Write the melody.",
  ].join("\n\n");
  const isFinalRange = toBar >= bars && !opts.counterTo;
  const endingRule = opts.counterTo
    ? `- Write a sparse counter-line under the main melody: long chord tones, mostly a third/sixth below it, filling the gaps where the main melody rests. Never cover the main melody's rhythm exactly.
- Stay within the given range.`
    : plan.loop
      ? `- The song will loop: end the melody with a pickup or a tone that leads into the first chord, and leave the last beat as a rest. Do not end on a long tonic.
- Stay within the given number of bars.`
      : isFinalRange
        ? `- In the final bar, land on the tonic and stop: use a note of about 1-2 beats, then leave the rest of the bar as a rest. Do not hold one note through the whole final bar.
- Stay within the given range.`
        : `- This is a middle phrase: end openly (no final tonic resolution) so the next phrase can continue. Leave a short breath before the range end.
- Stay within the given range.`;
  const ensembleRule =
    plan.ensemble === "orchestra"
      ? "\n- This is an orchestral piece: the melody will be played by the first violin. Write a singable, sustained line in the mid-high register and leave space for the accompaniment."
      : "";
  return [
    {
      role: "system",
      content: MELODY_SYSTEM + "\n" + endingRule + ensembleRule,
    },
    { role: "user", content: user },
  ];
}




