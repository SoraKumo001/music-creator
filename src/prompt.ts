import { pickGenreCards } from "./knowledge/genres";
import { progressionById, type ProgressionCard } from "./knowledge/progressions";
import type { ChatMessage } from "./llm/provider";
import type { Ensemble, Plan, Section } from "./plan";
import { BASS_STYLES, COMP_STYLES } from "./theory/accompaniment";
import { DRUM_PATTERN_NAMES } from "./theory/drums";
import { realizeNumerals } from "./theory/roman";

const list = (a: readonly string[]) => a.map((n) => `"${n}"`).join(", ");

/** ジャンルに合う進行カード。該当なしなら汎用の 4 枚 */
function progressionCards(userPrompt: string): ProgressionCard[] {
  const ids = new Set<string>();
  for (const genre of pickGenreCards(userPrompt)) for (const id of genre.progressions ?? []) ids.add(id);
  const chosen = [...ids].flatMap((id) => {
    const card = progressionById(id);
    return card ? [card] : [];
  });
  if (chosen.length > 0) return chosen.slice(0, 5);
  return ["pop-1564", "jpop-oudou", "jazz-251", "rock-minor"].flatMap((id) => {
    const card = progressionById(id);
    return card ? [card] : [];
  });
}

function progressionLine(card: ProgressionCard): string {
  const exampleKey = card.mode === "major" ? "C major" : "A minor";
  const example = realizeNumerals(card.numerals, exampleKey).join("–");
  const rhythm = `${card.harmonicRhythm} chord${card.harmonicRhythm > 1 ? "s" : ""}/bar`;
  return `- ${card.name} [${card.id}] ${card.numerals.join("–")} (${card.bars} bars, ${rhythm}). Example in ${exampleKey}: ${example}. Feel: ${card.feel}. Use: ${card.usage}`;
}

function progressionBlock(userPrompt: string): string {
  const cards = progressionCards(userPrompt);
  return `\n\nProgression vocabulary — choose ONE as the skeleton for the A section, and a different one (or a variation) for the B section:
${cards.map(progressionLine).join("\n")}

Harmony rules:
- Keep each skeleton's roman numerals. You may substitute at most one chord per section, and only for a chord with the same function.
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
  "ending": one of "button", "stop", "ring", "hits" (optional),
  "chords": [[startBeat, "Symbol"], ...],
  "sections": [{ "name": string, "bars": integer, "comp": one of ${list(COMP_STYLES)}, "bass": one of ${list(BASS_STYLES)}, "drums": one of ${list(DRUM_PATTERN_NAMES)}, "none", "energy": 1 | 2 | 3 }],
  "compProgram": GM instrument 0-127 for the chords,
  "bassProgram": GM instrument 0-127 for the bass,
  "melodyProgram": GM instrument 0-127 for the melody,
  "melodyName": string
}

Details:
- "chords": cover the whole song from beat 0, one entry per chord change (usually 1 or 2 per bar). A quarter note = 1 beat; bar n starts at (n-1) * beatsPerBar. Symbols: C, Cm, C7, Cmaj7, Cm7, Cm7b5, Cdim, Csus4, C6, C9, Cadd9, optional slash bass (C/E). Flats/sharps as Bb, F#.
- "sections": in order; their "bars" must add up to the requested length. Give the song a shape: e.g. a sparse intro (energy 1, drums "none", comp "pad" or "arpeggio"), a main A section (energy 2), a fuller B/chorus (energy 3, busier comp and bass), and optionally a calmer ending. For short songs (4-8 bars) use 2-3 sections.
- Vary "comp", "bass" and "drums" between sections so the arrangement develops; do not use identical settings for every section.
- "ending": choose the ending that fits the request. "button" = two short hits (pop); "stop" = one short hit then silence (rock/punk); "ring" = let the final chord ring out (ballad/lofi); "hits" = four stabs (dance/rock). Do not always use "button"; match the genre and mood. Omit it only if unsure (the app then derives one from tempo and key).
- Use 4-6 different chords. Use a different progression for the B/chorus section than for A.`;

export function planMessages(userPrompt: string, bars: number, loop = false, ensemble: Ensemble = "band"): ChatMessage[] {
  const cards = pickGenreCards(userPrompt);
  const knowledge = cards.length
    ? "\n\nGenre guidance:\n" + cards.map((c) => `- [${c.id}] ${c.card}`).join("\n")
    : "";
  const endingRule = loop
    ? `

This song will be LOOPED. The last bar is a turnaround, not an ending:
- Write the progression so the last bar leads back to the first chord: end on V (or V7), or a turnaround such as ii-V. Do not finish with a final tonic cadence.
- Start the progression on the tonic so that V resolves into the loop point.
- The "ending" field is ignored in loop mode; keep the harmonic rhythm steady across the loop point.`
    : `

- End with a cadence that resolves to the tonic chord in the final bar.`;
  const ensembleRule = ensemble === "orchestra"
    ? `

The arrangement will be ORCHESTRAL (strings, woodwinds, brass, timpani, harp). Focus on chords, sections and the melody; "comp", "bass" and "drums" styles are ignored. Use energy 1 for intimate passages and energy 3 for the full tutti.`
    : "";
  return [
    { role: "system", content: PLAN_SYSTEM + knowledge + progressionBlock(userPrompt) + endingRule + ensembleRule },
    { role: "user", content: `Request: ${userPrompt}\nLength: ${bars} bars.` },
  ];
}

const MELODY_SYSTEM = `You are a professional melody writer. Output ONLY one compact JSON object (no markdown): {"notes":[[pitch,start,duration,velocity],...]}
Each note is [MIDI note number, start in beats from the beginning of the song, duration in beats, velocity 1-127]. A quarter note = 1 beat.

Rules:
- Single-line melody (no simultaneous notes), mostly within MIDI 60-84.
- On strong beats (first and middle beat of a bar) and on long notes, use tones of the current chord. Use scale tones as passing notes between them.
- Build the melody from a short motif: state it, repeat it with variation, then contrast it in the next section. Reuse rhythms across bars.
- Mix note lengths (e.g. eighths, quarters, dotted and held notes) and leave rests so phrases can breathe. Move mostly by step with occasional leaps.
- Follow the section energy: sparse or silent in energy 1 sections, most active and highest in energy 3 sections.`;

export function melodyMessages(userPrompt: string, plan: Plan, sections: Section[], bars: number, beatsPerBar: number): ChatMessage[] {
  const chordLines: string[] = [];
  const sorted = [...plan.chords].sort((a, b) => a[0] - b[0]);
  for (let b = 0; b < bars; b++) {
    const s = b * beatsPerBar;
    const e = s + beatsPerBar;
    const inBar = sorted.filter(([t]) => t >= s && t < e);
    const carry = [...sorted].reverse().find(([t]) => t <= s);
    const parts = inBar.length && inBar[0]![0] === s ? inBar : [...(carry ? [[s, carry[1]] as [number, string]] : []), ...inBar];
    chordLines.push(`bar ${b + 1} (beats ${s}-${e}): ` + parts.map(([t, sym]) => `${sym}@${t}`).join(" "));
  }
  const sectionLines = sections.map(
    (s) => `- ${s.name}: bars ${s.startBar + 1}-${s.startBar + s.bars}, energy ${s.gain < 1 ? 1 : s.gain > 1 ? 3 : 2}`,
  );
  const user = [
    `Song request: ${userPrompt}`,
    `Title: ${plan.title}`,
    `Key: ${plan.key}, tempo ${plan.bpm} BPM, time signature ${plan.timeSignature.join("/")}, ${bars} bars (${bars * beatsPerBar} beats).`,
    `Sections:\n${sectionLines.join("\n")}`,
    `Chords:\n${chordLines.join("\n")}`,
    "Write the melody.",
  ].join("\n\n");
  const endingRule = plan.loop
    ? `- The song will loop: end the melody with a pickup or a tone that leads into the first chord, and leave the last beat as a rest. Do not end on a long tonic.
- Stay within the given number of bars.`
    : `- In the final bar, land on the tonic and stop: use a note of about 1-2 beats, then leave the rest of the bar as a rest. Do not hold one note through the whole final bar.
- Stay within the given number of bars.`;
  const ensembleRule = plan.ensemble === "orchestra"
    ? "\n- This is an orchestral piece: the melody will be played by the first violin. Write a singable, sustained line in the mid-high register and leave space for the accompaniment."
    : "";
  return [
    { role: "system", content: MELODY_SYSTEM + "\n" + endingRule + ensembleRule },
    { role: "user", content: user },
  ];
}
