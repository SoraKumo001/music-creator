// AUTO-GENERATED FILE — do not edit by hand.
// 生成: npm run analyze:corpus
// このデータは MIDI コーパスの集計統計のみ (旋律・譜面は含まない)。
import type { CorpusProfile } from "../analyze/corpus";

export const CORPUS_PROFILE: CorpusProfile | null = {
  "version": 1,
  "generatedAt": "2026-11-10T07:33:47.369Z",
  "source": {
    "label": "zob-midi-sample40",
    "files": 40,
    "analyzed": 40,
    "skipped": 0,
    "inferredBarShare": 0.925
  },
  "tempo": {
    "median": 125,
    "p10": 125,
    "p90": 125,
    "buckets": {
      "120-129": 1
    }
  },
  "meters": {
    "4/4": 1
  },
  "keys": {
    "C minor": 0.15,
    "D major": 0.1,
    "C major": 0.075,
    "A major": 0.075,
    "G# major": 0.05,
    "E minor": 0.05,
    "A# minor": 0.05,
    "C# major": 0.05,
    "A minor": 0.05,
    "G major": 0.05,
    "A# major": 0.05,
    "F# minor": 0.05
  },
  "modeShare": {
    "major": 0.525,
    "minor": 0.475
  },
  "instruments": {
    "synthLead": 0.257,
    "guitar": 0.205,
    "bass": 0.161,
    "brass": 0.076,
    "piano": 0.065,
    "reed": 0.058,
    "strings": 0.047,
    "organ": 0.04,
    "ensemble": 0.033,
    "synthFx": 0.029,
    "chromatic": 0.017,
    "percussive": 0.012
  },
  "drums": {
    "35": 0.039,
    "36": 0.224,
    "38": 0.25,
    "40": 0.035,
    "42": 0.25,
    "46": 0.02,
    "48": 0.021,
    "82": 0.066
  },
  "rhythm": {
    "beatPos16": [
      0.0731,
      0.0561,
      0.0648,
      0.0646,
      0.065,
      0.0609,
      0.0641,
      0.0617,
      0.0672,
      0.0565,
      0.0634,
      0.0605,
      0.0642,
      0.0596,
      0.061,
      0.0573
    ],
    "downbeatShare": 0.269,
    "offbeat8thShare": 0.253,
    "sixteenthShare": 0.477,
    "offGridShare": 0.37,
    "durations16": [
      0.5511,
      0.2529,
      0.0448,
      0.0449,
      0.0145,
      0.0114,
      0.0104,
      0.0065,
      0.018,
      0.003,
      0.0013,
      0.0051,
      0.0019,
      0.0033,
      0.0018,
      0.0294
    ],
    "medianMelodyNotesPerBar": 7.38,
    "medianMelodyRange": 31
  },
  "harmony": {
    "medianChordsPerBar": 1,
    "qualities": {
      "5": 0.047,
      "7": 0.106,
      "sus4": 0.233,
      "m7": 0.21,
      "maj": 0.147,
      "maj7": 0.145,
      "m": 0.06,
      "m7b5": 0.022
    },
    "borrowedRate": 0.391,
    "topBigrams": [
      {
        "pair": "Isus4>Isus4",
        "share": 0.029
      },
      {
        "pair": "i7>i7",
        "share": 0.028
      },
      {
        "pair": "Vsus4>Vsus4",
        "share": 0.016
      },
      {
        "pair": "iv7>iv7",
        "share": 0.013
      },
      {
        "pair": "Isus4>i7",
        "share": 0.011
      },
      {
        "pair": "i7>VImaj7",
        "share": 0.01
      },
      {
        "pair": "i>i",
        "share": 0.01
      },
      {
        "pair": "I5>I5",
        "share": 0.01
      },
      {
        "pair": "I>I",
        "share": 0.009
      },
      {
        "pair": "VImaj7>VImaj7",
        "share": 0.008
      }
    ],
    "topProgressions": [
      {
        "numerals": "Isus4>I>I",
        "share": 0.005
      },
      {
        "numerals": "Isus4>i7>Isus4",
        "share": 0.004
      },
      {
        "numerals": "Vsus4>Isus4>Isus4",
        "share": 0.004
      },
      {
        "numerals": "Vsus4>Vsus4>V7/V",
        "share": 0.004
      },
      {
        "numerals": "Isus4>Isus4>i7",
        "share": 0.002
      },
      {
        "numerals": "I>V7/IV>vi7",
        "share": 0.002
      }
    ]
  },
  "form": {
    "medianSectionBars": 4,
    "sectionBarPercentiles": [
      2,
      4,
      12
    ],
    "medianSections": 7
  },
  "insights": [
    "Tempo: the tempo metadata is uniform at 125 BPM across this corpus (authoring convention), so do not use tempo as a style prior — vary tempo to fit the request.",
    "Meter: 4/4 dominates (100%); other meters are special cases.",
    "Mode: major 53% / minor 48% — minor is common, so don't default to major.",
    "Instrument focus (by note count): synthLead 26%, guitar 21%, bass 16%, brass 8%.",
    "Drum emphasis: acousticBassDrum 4%, bassDrum 22%, snare 25%, electricSnare 4%.",
    "Rhythm: downbeat onsets 27%, off-beat 8ths 25%, 16ths 48%, other subdivisions 37%.",
    "Harmonic rhythm: about 1 chord(s) per bar; borrowed/secondary chords in about 39% of chord slots.",
    "Chord qualities: 5 5%, 7 11%, sus4 23%, m7 21%.",
    "Common moves (roman, from→to): Isus4→i7 1%, i7→VImaj7 1%.",
    "Common 3-chord cells: Isus4–I–I / Isus4–i7–Isus4 / Vsus4–Isus4–Isus4 / Vsus4–Vsus4–V7/V.",
    "Form: sections usually 2-12 bars (median 4); about 7 sections per piece."
  ]
};
