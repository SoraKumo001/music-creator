import { pickGenreCards } from "./knowledge/genres";
import { corpusGuidance } from "./knowledge/corpus";
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
import { realizeNumerals } from "./theory/roman";
import { hashSeed, mulberry32, sampleSeeded } from "./util/random";

const list = (a: readonly string[]) => a.map((n) => `"${n}"`).join(", ");

/** ジャンルに合う進行カード。該当なしならseedで汎用カードからサンプル (毎回同じ4枚にしない) */
function progressionCards(
  userPrompt: string,
  seed?: number,
): ProgressionCard[] {
  const ids = new Set<string>();
  for (const genre of pickGenreCards(userPrompt))
    for (const id of genre.progressions ?? []) ids.add(id);
  const chosen = [...ids].flatMap((id) => {
    const card = progressionById(id);
    return card ? [card] : [];
  });
  if (chosen.length > 0) return chosen.slice(0, 5);
  // フォールバック: 全カードから決定的サンプル。seed未指定でもpromptハッシュで揺らす
  const rand = mulberry32(seed ?? hashSeed(userPrompt));
  return sampleSeeded(PROGRESSIONS, 5, rand);
}

function progressionLine(card: ProgressionCard): string {
  const exampleKey = card.mode === "major" ? "C major" : "A minor";
  const example = realizeNumerals(card.numerals, exampleKey).join("–");
  const rhythm = `${card.harmonicRhythm} chord${card.harmonicRhythm > 1 ? "s" : ""}/bar`;
  return `- ${card.name} [${card.id}] ${card.numerals.join("–")} (${card.bars} bars, ${rhythm}). Example in ${exampleKey}: ${example}. Feel: ${card.feel}. Use: ${card.usage}`;
}

function progressionBlock(userPrompt: string, seed?: number): string {
  const cards = progressionCards(userPrompt, seed);
  return `\n\nProgression vocabulary — choose ONE as the skeleton for the A section, and a different one (or a variation) for the B section:
${cards.map(progressionLine).join("\n")}

Harmony rules:
- Keep each skeleton's roman numerals and repeat the 4-bar skeleton across an 8-bar section (or repeat the same progression when verse/chorus returns) so the listener hears a clear, recurring harmonic theme. You may substitute at most one chord per section, and only for a chord with the same function.
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
  "key": string (e.g. "C minor"),
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
        progressionBlock(userPrompt, opts.seed) +
        (opts.corpus === false ? "" : corpusGuidance()) +
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
