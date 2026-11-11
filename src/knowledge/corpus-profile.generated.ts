// AUTO-GENERATED FILE — do not edit by hand.
// 生成: npm run analyze:corpus
// このデータは MIDI コーパスの集計統計のみ (旋律・譜面は含まない)。
import type { CorpusProfile } from "../analyze/corpus";

export const CORPUS_PROFILE: CorpusProfile | null = {
  "version": 3,
  "generatedAt": "2026-11-11T05:00:23.038Z",
  "source": {
    "label": "midi-corpus",
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
  "drumByEnergy": {
    "densityTertiles": [
      47.33,
      78.8
    ],
    "low": {
      "sections": 80,
      "shares": {
        "35": 0.023,
        "36": 0.309,
        "38": 0.228,
        "40": 0.044,
        "42": 0.192,
        "44": 0.037,
        "46": 0.023,
        "51": 0.055
      },
      "medianHitsPerBar": 8.8,
      "medianDensity": 29.5
    },
    "mid": {
      "sections": 80,
      "shares": {
        "35": 0.049,
        "36": 0.17,
        "38": 0.342,
        "42": 0.237,
        "46": 0.023,
        "48": 0.013,
        "65": 0.016,
        "82": 0.093
      },
      "medianHitsPerBar": 14.7,
      "medianDensity": 62.6
    },
    "high": {
      "sections": 78,
      "shares": {
        "35": 0.04,
        "36": 0.22,
        "38": 0.18,
        "40": 0.051,
        "42": 0.299,
        "48": 0.036,
        "53": 0.016,
        "82": 0.076
      },
      "medianHitsPerBar": 11.8,
      "medianDensity": 95.6
    }
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
    "medianMelodyRange": 31,
    "drumHitsPerBar": 12.65
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
    "susShare": 0.258,
    "seventhShare": 0.451,
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
  "bass": {
    "medianNotesPerBar": 9.02,
    "medianPitch": 36,
    "motionHistogram": [
      0.7005,
      0.0197,
      0.0498,
      0.0178,
      0.0148,
      0.0472,
      0.0023,
      0.0379,
      0.0093,
      0.0115,
      0.0614,
      0.0277
    ],
    "fifthShare": 0.085,
    "stepShare": 0.069,
    "leapShare": 0.11
  },
  "melody": {
    "medianPitch": 77,
    "stepwiseShare": 0.476,
    "restRatio": 0.006,
    "medianDuration16": 1.4
  },
  "instrumentStats": {
    "synthLead": {
      "share": 0.257,
      "medianNotesPerBar": 12.71,
      "medianPitch": 67
    },
    "guitar": {
      "share": 0.205,
      "medianNotesPerBar": 16.27,
      "medianPitch": 63.5
    },
    "bass": {
      "share": 0.161,
      "medianNotesPerBar": 13.88,
      "medianPitch": 36
    },
    "brass": {
      "share": 0.076,
      "medianNotesPerBar": 8.51,
      "medianPitch": 68
    },
    "piano": {
      "share": 0.065,
      "medianNotesPerBar": 13.6,
      "medianPitch": 58.8
    },
    "reed": {
      "share": 0.058,
      "medianNotesPerBar": 7.39,
      "medianPitch": 72
    },
    "strings": {
      "share": 0.047,
      "medianNotesPerBar": 12.84,
      "medianPitch": 41
    },
    "organ": {
      "share": 0.04,
      "medianNotesPerBar": 3.17,
      "medianPitch": 73
    },
    "ensemble": {
      "share": 0.033,
      "medianNotesPerBar": 2.92,
      "medianPitch": 70.8
    },
    "synthFx": {
      "share": 0.029,
      "medianNotesPerBar": 3.05,
      "medianPitch": 75
    },
    "chromatic": {
      "share": 0.017,
      "medianNotesPerBar": 2.83,
      "medianPitch": 72
    },
    "percussive": {
      "share": 0.012,
      "medianNotesPerBar": 0.51,
      "medianPitch": 49
    }
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
    "Mode: major 53% / minor 48% — the corpus uses both about equally; match the mode to the request (bright/heroic material tends major) and do not default to minor.",
    "Instrument focus (by note count): synthLead 26%, guitar 21%, bass 16%, brass 8%.",
    "Drum emphasis: acousticBassDrum 4%, bassDrum 22%, snare 25%, electricSnare 4%.",
    "Drum emphasis by section density (47.33-78.8 onsets/bar): low (8.8 hits/bar): acousticBassDrum 2%, bassDrum 31%, snare 23%; mid (14.7 hits/bar): acousticBassDrum 5%, bassDrum 17%, snare 34%; high (11.8 hits/bar): acousticBassDrum 4%, bassDrum 22%, snare 18%.",
    "Section density targets (onsets/bar): low 29.5, mid 62.6, high 95.6.",
    "Rhythm: downbeat onsets 27%, off-beat 8ths 25%, 16ths 48%, other subdivisions 37%.",
    "Harmonic rhythm: about 1 chord(s) per bar; borrowed/secondary chords in about 39% of chord slots.",
    "Chord qualities: 5 5%, 7 11%, sus4 23%, m7 21%; sus chords 26%, 7th chords 45%.",
    "Bass: about 9.02 notes/bar around register 36; root motion steps 7%, 4ths/5ths 9%, leaps 11%.",
    "Melody: about 7.38 notes/bar (range ~31 semitones), median register 77; stepwise motion 48%, phrase gaps in 1% of moves, median note length 1.4 (16ths).",
    "Typical registers: synthLead ~67, guitar ~63.5, bass ~36.",
    "Common moves (roman, from→to): Isus4→i7 1%, i7→VImaj7 1%.",
    "Common 3-chord cells: Isus4–I–I / Isus4–i7–Isus4 / Vsus4–Isus4–Isus4 / Vsus4–Vsus4–V7/V.",
    "Form: sections usually 2-12 bars (median 4); about 7 sections per piece."
  ]
};

export const CORPUS_PROFILES_BY_MODE: { major: CorpusProfile; minor: CorpusProfile } | null = {
  "major": {
    "version": 3,
    "generatedAt": "2026-11-11T05:00:23.042Z",
    "source": {
      "label": "midi-corpus-major",
      "files": 21,
      "analyzed": 21,
      "skipped": 0,
      "inferredBarShare": 0.905
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
      "D major": 0.19,
      "C major": 0.143,
      "A major": 0.143,
      "G# major": 0.095,
      "C# major": 0.095,
      "G major": 0.095,
      "A# major": 0.095,
      "F major": 0.048,
      "E major": 0.048,
      "B major": 0.048
    },
    "modeShare": {
      "major": 1,
      "minor": 0
    },
    "instruments": {
      "synthLead": 0.253,
      "bass": 0.193,
      "guitar": 0.175,
      "brass": 0.089,
      "reed": 0.081,
      "strings": 0.055,
      "synthFx": 0.05,
      "organ": 0.038,
      "piano": 0.028,
      "chromatic": 0.017,
      "ensemble": 0.012,
      "percussive": 0.007
    },
    "drums": {
      "35": 0.055,
      "36": 0.201,
      "38": 0.351,
      "40": 0.026,
      "42": 0.311,
      "46": 0.009,
      "53": 0.009,
      "65": 0.009
    },
    "drumByEnergy": {
      "densityTertiles": [
        61,
        84
      ],
      "low": {
        "sections": 46,
        "shares": {
          "35": 0.061,
          "36": 0.243,
          "38": 0.304,
          "42": 0.345,
          "45": 0.004,
          "46": 0.008,
          "57": 0.01,
          "65": 0.019
        },
        "medianHitsPerBar": 16.5,
        "medianDensity": 49.1
      },
      "mid": {
        "sections": 46,
        "shares": {
          "35": 0.03,
          "36": 0.113,
          "38": 0.664,
          "40": 0.016,
          "42": 0.133,
          "47": 0.008,
          "48": 0.008,
          "57": 0.012
        },
        "medianHitsPerBar": 9.9,
        "medianDensity": 71.5
      },
      "high": {
        "sections": 41,
        "shares": {
          "35": 0.066,
          "36": 0.205,
          "38": 0.148,
          "40": 0.081,
          "42": 0.415,
          "45": 0.014,
          "46": 0.016,
          "53": 0.033
        },
        "medianHitsPerBar": 12.5,
        "medianDensity": 104.1
      }
    },
    "rhythm": {
      "beatPos16": [
        0.0679,
        0.0564,
        0.0644,
        0.0652,
        0.0611,
        0.0641,
        0.0634,
        0.065,
        0.0662,
        0.057,
        0.0649,
        0.062,
        0.0651,
        0.06,
        0.061,
        0.0564
      ],
      "downbeatShare": 0.26,
      "offbeat8thShare": 0.254,
      "sixteenthShare": 0.486,
      "offGridShare": 0.385,
      "durations16": [
        0.6138,
        0.2517,
        0.0366,
        0.0257,
        0.0058,
        0.0053,
        0.0131,
        0.0028,
        0.0044,
        0.0021,
        0.002,
        0.0014,
        0.0004,
        0.002,
        0.0022,
        0.0308
      ],
      "medianMelodyNotesPerBar": 7,
      "medianMelodyRange": 36,
      "drumHitsPerBar": 12.57
    },
    "harmony": {
      "medianChordsPerBar": 1,
      "qualities": {
        "5": 0.05,
        "7": 0.102,
        "sus4": 0.286,
        "m7": 0.191,
        "maj": 0.159,
        "maj7": 0.117,
        "m": 0.05,
        "m7b5": 0.017
      },
      "borrowedRate": 0.516,
      "susShare": 0.313,
      "seventhShare": 0.406,
      "topBigrams": [
        {
          "pair": "Isus4>Isus4",
          "share": 0.048
        },
        {
          "pair": "Vsus4>Vsus4",
          "share": 0.022
        },
        {
          "pair": "I>I",
          "share": 0.016
        },
        {
          "pair": "I5>I5",
          "share": 0.013
        },
        {
          "pair": "Isus4>I",
          "share": 0.013
        },
        {
          "pair": "Isus4>i7",
          "share": 0.012
        },
        {
          "pair": "ii7>ii7",
          "share": 0.012
        },
        {
          "pair": "Isus4>V7/IV",
          "share": 0.012
        },
        {
          "pair": "vi7>vi7",
          "share": 0.012
        },
        {
          "pair": "V7/IV>V7/IV",
          "share": 0.01
        }
      ],
      "topProgressions": [
        {
          "numerals": "Isus4>I>I",
          "share": 0.01
        },
        {
          "numerals": "Vsus4>Isus4>Isus4",
          "share": 0.007
        },
        {
          "numerals": "Isus4>Isus4>i7",
          "share": 0.005
        },
        {
          "numerals": "I>V7/IV>vi7",
          "share": 0.005
        },
        {
          "numerals": "I>vi7>vi7",
          "share": 0.005
        },
        {
          "numerals": "Isus4>i7>Isus4",
          "share": 0.005
        }
      ]
    },
    "bass": {
      "medianNotesPerBar": 10,
      "medianPitch": 36,
      "motionHistogram": [
        0.7444,
        0.0191,
        0.0415,
        0.011,
        0.0124,
        0.0472,
        0.001,
        0.0328,
        0.002,
        0.0041,
        0.0509,
        0.0336
      ],
      "fifthShare": 0.08,
      "stepShare": 0.06,
      "leapShare": 0.09
    },
    "melody": {
      "medianPitch": 77,
      "stepwiseShare": 0.49,
      "restRatio": 0.003,
      "medianDuration16": 1.3
    },
    "instrumentStats": {
      "synthLead": {
        "share": 0.253,
        "medianNotesPerBar": 15.8,
        "medianPitch": 69
      },
      "bass": {
        "share": 0.193,
        "medianNotesPerBar": 16.8,
        "medianPitch": 36
      },
      "guitar": {
        "share": 0.175,
        "medianNotesPerBar": 11.17,
        "medianPitch": 69
      },
      "brass": {
        "share": 0.089,
        "medianNotesPerBar": 10.19,
        "medianPitch": 68
      },
      "reed": {
        "share": 0.081,
        "medianNotesPerBar": 9,
        "medianPitch": 72
      },
      "strings": {
        "share": 0.055,
        "medianNotesPerBar": 13.46,
        "medianPitch": 36.5
      },
      "synthFx": {
        "share": 0.05,
        "medianNotesPerBar": 3.05,
        "medianPitch": 75
      },
      "organ": {
        "share": 0.038,
        "medianNotesPerBar": 3.17,
        "medianPitch": 67.5
      },
      "piano": {
        "share": 0.028,
        "medianNotesPerBar": 2.35,
        "medianPitch": 62
      },
      "chromatic": {
        "share": 0.017,
        "medianNotesPerBar": 3.35,
        "medianPitch": 75.5
      },
      "ensemble": {
        "share": 0.012,
        "medianNotesPerBar": 2.92,
        "medianPitch": 70.3
      },
      "percussive": {
        "share": 0.007,
        "medianNotesPerBar": 0.36,
        "medianPitch": 49
      }
    },
    "form": {
      "medianSectionBars": 4,
      "sectionBarPercentiles": [
        2,
        4,
        12.6
      ],
      "medianSections": 7
    },
    "insights": [
      "Tempo: the tempo metadata is uniform at 125 BPM across this corpus (authoring convention), so do not use tempo as a style prior — vary tempo to fit the request.",
      "Meter: 4/4 dominates (100%); other meters are special cases.",
      "Mode: major 100% / minor 0% — major is more common; prefer major unless the request asks for a dark, sad or tense mood.",
      "Instrument focus (by note count): synthLead 25%, bass 19%, guitar 18%, brass 9%.",
      "Drum emphasis: acousticBassDrum 6%, bassDrum 20%, snare 35%, electricSnare 3%.",
      "Drum emphasis by section density (61-84 onsets/bar): low (16.5 hits/bar): acousticBassDrum 6%, bassDrum 24%, snare 30%; mid (9.9 hits/bar): acousticBassDrum 3%, bassDrum 11%, snare 66%; high (12.5 hits/bar): acousticBassDrum 7%, bassDrum 21%, snare 15%.",
      "Section density targets (onsets/bar): low 49.1, mid 71.5, high 104.1.",
      "Rhythm: downbeat onsets 26%, off-beat 8ths 25%, 16ths 49%, other subdivisions 39%.",
      "Harmonic rhythm: about 1 chord(s) per bar; borrowed/secondary chords in about 52% of chord slots.",
      "Chord qualities: 5 5%, 7 10%, sus4 29%, m7 19%; sus chords 31%, 7th chords 41%.",
      "Bass: about 10 notes/bar around register 36; root motion steps 6%, 4ths/5ths 8%, leaps 9%.",
      "Melody: about 7 notes/bar (range ~36 semitones), median register 77; stepwise motion 49%, phrase gaps in 0% of moves, median note length 1.3 (16ths).",
      "Typical registers: synthLead ~69, bass ~36, guitar ~69.",
      "Common moves (roman, from→to): Isus4→I 1%, Isus4→i7 1%, Isus4→V7/IV 1%.",
      "Common 3-chord cells: Isus4–I–I / Vsus4–Isus4–Isus4 / Isus4–Isus4–i7 / I–V7/IV–vi7.",
      "Form: sections usually 2-12.6 bars (median 4); about 7 sections per piece."
    ]
  },
  "minor": {
    "version": 3,
    "generatedAt": "2026-11-11T05:00:23.044Z",
    "source": {
      "label": "midi-corpus-minor",
      "files": 19,
      "analyzed": 19,
      "skipped": 0,
      "inferredBarShare": 0.947
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
      "C minor": 0.316,
      "E minor": 0.105,
      "A# minor": 0.105,
      "A minor": 0.105,
      "F# minor": 0.105,
      "F minor": 0.053,
      "D minor": 0.053,
      "B minor": 0.053,
      "C# minor": 0.053,
      "G minor": 0.053
    },
    "modeShare": {
      "major": 0,
      "minor": 1
    },
    "instruments": {
      "synthLead": 0.263,
      "guitar": 0.248,
      "bass": 0.116,
      "piano": 0.115,
      "ensemble": 0.062,
      "brass": 0.057,
      "organ": 0.043,
      "strings": 0.035,
      "reed": 0.025,
      "percussive": 0.019,
      "chromatic": 0.017
    },
    "drums": {
      "36": 0.25,
      "38": 0.139,
      "40": 0.044,
      "42": 0.184,
      "46": 0.031,
      "48": 0.039,
      "51": 0.029,
      "82": 0.137
    },
    "drumByEnergy": {
      "densityTertiles": [
        29.72,
        63.61
      ],
      "low": {
        "sections": 35,
        "shares": {
          "35": 0.038,
          "36": 0.342,
          "38": 0.139,
          "40": 0.097,
          "42": 0.121,
          "44": 0.124,
          "46": 0.054,
          "82": 0.031
        },
        "medianHitsPerBar": 7,
        "medianDensity": 22.3
      },
      "mid": {
        "sections": 35,
        "shares": {
          "36": 0.233,
          "38": 0.204,
          "40": 0.038,
          "42": 0.177,
          "46": 0.042,
          "48": 0.033,
          "51": 0.147,
          "54": 0.057
        },
        "medianHitsPerBar": 11,
        "medianDensity": 42.8
      },
      "high": {
        "sections": 35,
        "shares": {
          "36": 0.232,
          "38": 0.121,
          "40": 0.033,
          "42": 0.201,
          "46": 0.023,
          "48": 0.047,
          "65": 0.035,
          "82": 0.201
        },
        "medianHitsPerBar": 13,
        "medianDensity": 83.3
      }
    },
    "rhythm": {
      "beatPos16": [
        0.079,
        0.0557,
        0.0652,
        0.0639,
        0.0693,
        0.0574,
        0.0649,
        0.0581,
        0.0684,
        0.056,
        0.0618,
        0.0589,
        0.0632,
        0.0592,
        0.061,
        0.0582
      ],
      "downbeatShare": 0.28,
      "offbeat8thShare": 0.253,
      "sixteenthShare": 0.467,
      "offGridShare": 0.353,
      "durations16": [
        0.4819,
        0.2542,
        0.0538,
        0.066,
        0.024,
        0.0181,
        0.0073,
        0.0105,
        0.0331,
        0.0038,
        0.0005,
        0.0091,
        0.0037,
        0.0048,
        0.0013,
        0.0279
      ],
      "medianMelodyNotesPerBar": 7.67,
      "medianMelodyRange": 28,
      "drumHitsPerBar": 14.19
    },
    "harmony": {
      "medianChordsPerBar": 1,
      "qualities": {
        "5": 0.044,
        "7": 0.111,
        "m7": 0.231,
        "maj7": 0.178,
        "sus4": 0.172,
        "maj": 0.133,
        "m": 0.071,
        "m7b5": 0.029
      },
      "borrowedRate": 0.252,
      "susShare": 0.197,
      "seventhShare": 0.5,
      "topBigrams": [
        {
          "pair": "i7>i7",
          "share": 0.058
        },
        {
          "pair": "i7>VImaj7",
          "share": 0.022
        },
        {
          "pair": "iv7>iv7",
          "share": 0.018
        },
        {
          "pair": "VImaj7>VImaj7",
          "share": 0.017
        },
        {
          "pair": "V7/VI>V7/VI",
          "share": 0.014
        },
        {
          "pair": "i>i",
          "share": 0.012
        },
        {
          "pair": "Imaj7>VImaj7",
          "share": 0.011
        },
        {
          "pair": "Isus4>i",
          "share": 0.01
        },
        {
          "pair": "VImaj7>i7",
          "share": 0.01
        },
        {
          "pair": "iv7>IVsus4",
          "share": 0.01
        }
      ],
      "topProgressions": [
        {
          "numerals": "V7/VI>V7/VI>III",
          "share": 0.005
        },
        {
          "numerals": "III>V7/VI>i7",
          "share": 0.005
        },
        {
          "numerals": "Vsus4>V>Vsus4",
          "share": 0.005
        },
        {
          "numerals": "i7>i7>VImaj7",
          "share": 0.005
        },
        {
          "numerals": "i7>VImaj7>VImaj7",
          "share": 0.005
        },
        {
          "numerals": "I+>Isus4>i",
          "share": 0.003
        }
      ]
    },
    "bass": {
      "medianNotesPerBar": 8.26,
      "medianPitch": 36,
      "motionHistogram": [
        0.652,
        0.0205,
        0.0591,
        0.0253,
        0.0173,
        0.0471,
        0.0038,
        0.0435,
        0.0174,
        0.0197,
        0.0731,
        0.0213
      ],
      "fifthShare": 0.091,
      "stepShare": 0.079,
      "leapShare": 0.132
    },
    "melody": {
      "medianPitch": 77,
      "stepwiseShare": 0.461,
      "restRatio": 0.008,
      "medianDuration16": 1.4
    },
    "instrumentStats": {
      "synthLead": {
        "share": 0.263,
        "medianNotesPerBar": 9.24,
        "medianPitch": 62
      },
      "guitar": {
        "share": 0.248,
        "medianNotesPerBar": 22.84,
        "medianPitch": 56.5
      },
      "bass": {
        "share": 0.116,
        "medianNotesPerBar": 10.54,
        "medianPitch": 34
      },
      "piano": {
        "share": 0.115,
        "medianNotesPerBar": 16.52,
        "medianPitch": 51
      },
      "ensemble": {
        "share": 0.062,
        "medianNotesPerBar": 2.92,
        "medianPitch": 73.5
      },
      "brass": {
        "share": 0.057,
        "medianNotesPerBar": 8.25,
        "medianPitch": 66.3
      },
      "organ": {
        "share": 0.043,
        "medianNotesPerBar": 8.52,
        "medianPitch": 76
      },
      "strings": {
        "share": 0.035,
        "medianNotesPerBar": 7.14,
        "medianPitch": 45
      },
      "reed": {
        "share": 0.025,
        "medianNotesPerBar": 6.86,
        "medianPitch": 82.5
      },
      "percussive": {
        "share": 0.019,
        "medianNotesPerBar": 0.65,
        "medianPitch": 59
      },
      "chromatic": {
        "share": 0.017,
        "medianNotesPerBar": 1.95,
        "medianPitch": 70.5
      }
    },
    "form": {
      "medianSectionBars": 4,
      "sectionBarPercentiles": [
        2,
        4,
        10.1
      ],
      "medianSections": 7
    },
    "insights": [
      "Tempo: the tempo metadata is uniform at 125 BPM across this corpus (authoring convention), so do not use tempo as a style prior — vary tempo to fit the request.",
      "Meter: 4/4 dominates (100%); other meters are special cases.",
      "Mode: major 0% / minor 100% — minor is a little more common here; both modes are normal, so choose by the requested mood instead of defaulting.",
      "Instrument focus (by note count): synthLead 26%, guitar 25%, bass 12%, piano 12%.",
      "Drum emphasis: bassDrum 25%, snare 14%, electricSnare 4%, closedHat 18%.",
      "Drum emphasis by section density (29.72-63.61 onsets/bar): low (7 hits/bar): acousticBassDrum 4%, bassDrum 34%, snare 14%; mid (11 hits/bar): bassDrum 23%, snare 20%, electricSnare 4%; high (13 hits/bar): bassDrum 23%, snare 12%, electricSnare 3%.",
      "Section density targets (onsets/bar): low 22.3, mid 42.8, high 83.3.",
      "Rhythm: downbeat onsets 28%, off-beat 8ths 25%, 16ths 47%, other subdivisions 35%.",
      "Harmonic rhythm: about 1 chord(s) per bar; borrowed/secondary chords in about 25% of chord slots.",
      "Chord qualities: 5 4%, 7 11%, m7 23%, maj7 18%; sus chords 20%, 7th chords 50%.",
      "Bass: about 8.26 notes/bar around register 36; root motion steps 8%, 4ths/5ths 9%, leaps 13%.",
      "Melody: about 7.67 notes/bar (range ~28 semitones), median register 77; stepwise motion 46%, phrase gaps in 1% of moves, median note length 1.4 (16ths).",
      "Typical registers: synthLead ~62, guitar ~56.5, bass ~34.",
      "Common moves (roman, from→to): i7→VImaj7 2%, Imaj7→VImaj7 1%, Isus4→i 1%, VImaj7→i7 1%, iv7→IVsus4 1%.",
      "Common 3-chord cells: V7/VI–V7/VI–III / III–V7/VI–i7 / Vsus4–V–Vsus4 / i7–i7–VImaj7.",
      "Form: sections usually 2-10.1 bars (median 4); about 7 sections per piece."
    ]
  }
};
