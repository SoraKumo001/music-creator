import { describe, expect, it } from "vitest";
import { detectCadence } from "../src/theory/cadence";
import { isRetrogression } from "../src/theory/functions";
import { degreeChord, diatonicTriad, keyName, parseKeyName, type KeyContext } from "../src/theory/key";
import { analyzeChord, parseNumeral, realizeNumeral, realizeNumerals } from "../src/theory/roman";

const numeral = (symbol: string, key = "C major") => analyzeChord(symbol, key).numeral;
const fn = (symbol: string, key = "C major") => analyzeChord(symbol, key).fn;
const cadence = (a: string, b: string, key = "C major") => detectCadence(analyzeChord(a, key), analyzeChord(b, key));

describe("key", () => {
  it("parses key names", () => {
    expect(parseKeyName("C major")).toEqual({ root: 0, mode: "major" });
    expect(parseKeyName("A minor")).toEqual({ root: 9, mode: "minor" });
    expect(parseKeyName("F# minor")).toEqual({ root: 6, mode: "minor" });
    expect(parseKeyName("Bb")).toEqual({ root: 10, mode: "major" });
    expect(parseKeyName("Cm")).toEqual({ root: 0, mode: "minor" });
  });

  it("names keys with the conventional accidental", () => {
    expect(keyName({ root: 10, mode: "major" })).toBe("Bb major");
    expect(keyName({ root: 9, mode: "minor" })).toBe("A minor");
    expect(keyName({ root: 6, mode: "major" })).toBe("Gb major");
  });
});

describe("roman numerals in C major", () => {
  const cases: [string, string][] = [
    ["C", "I"],
    ["Cmaj7", "Imaj7"],
    ["Dm", "ii"],
    ["Dm7", "ii7"],
    ["Em", "iii"],
    ["Em7", "iii7"],
    ["F", "IV"],
    ["Fmaj7", "IVmaj7"],
    ["G", "V"],
    ["G7", "V7"],
    ["Am", "vi"],
    ["Am7", "vi7"],
    ["Bdim", "vii°"],
    ["Bm7b5", "viiø7"],
    ["Csus4", "Isus4"],
    ["C6", "I6"],
  ];
  it.each(cases)("%s -> %s", (symbol, expected) => {
    expect(numeral(symbol)).toBe(expected);
  });
});

describe("inversions", () => {
  it.each([
    ["F/A", "IV6", 1],
    ["G/B", "V6", 1],
    ["C/G", "I64", 2],
    ["G7/B", "V65", 1],
    ["G7/D", "V43", 2],
    ["G7/F", "V42", 3],
  ] as [string, string, number][])("%s -> %s", (symbol, expected, inv) => {
    const a = analyzeChord(symbol, "C major");
    expect(a.numeral).toBe(expected);
    expect(a.inversion).toBe(inv);
  });
});

describe("chromatic chords", () => {
  it("finds secondary dominants", () => {
    expect(numeral("D7")).toBe("V7/V");
    expect(numeral("A7")).toBe("V7/ii");
    expect(numeral("E7")).toBe("V7/vi");
    expect(numeral("B7")).toBe("V7/iii");
    expect(numeral("C7")).toBe("V7/IV");
    expect(numeral("F#7")).toBe("V7/vii°");
    expect(analyzeChord("D7", "C major").appliedTo).toBe(5);
    expect(analyzeChord("D7", "C major").fn).toBe("D");
  });

  it("labels tritone substitution and Neapolitan", () => {
    expect(numeral("Db7")).toBe("bII7");
    expect(analyzeChord("Db7", "C major").borrowedFrom).toBe("tritoneSub");
    expect(numeral("Db")).toBe("bII");
    expect(analyzeChord("Db", "C major").borrowedFrom).toBe("neapolitan");
  });

  it("labels borrowed chords from the parallel minor", () => {
    const cases: [string, string][] = [
      ["Fm", "iv"],
      ["Ab", "bVI"],
      ["Bb", "bVII"],
      ["Eb", "bIII"],
      ["Gm", "v"],
    ];
    for (const [symbol, expected] of cases) {
      const a = analyzeChord(symbol, "C major");
      expect(a.numeral).toBe(expected);
      expect(a.borrowedFrom).toBe("parallelMinor");
      expect(a.isDiatonic).toBe(false);
    }
  });

  it("explains a major-key IV7 as mixolydian", () => {
    const a = analyzeChord("F7", "C major");
    expect(a.numeral).toBe("IV7");
    expect(a.borrowedFrom).toBe("mixolydian");
    expect(a.isDiatonic).toBe(false);
  });
});

describe("roman numerals in A minor", () => {
  it.each([
    ["Am", "i"],
    ["Bdim", "ii°"],
    ["C", "III"],
    ["Dm", "iv"],
    ["Em", "v"],
    ["E", "V"],
    ["E7", "V7"],
    ["F", "VI"],
    ["G", "VII"],
    ["G#dim", "vii°"],
    ["Bm7b5", "iiø7"],
    ["D", "IV"],
  ] as [string, string][])("%s -> %s", (symbol, expected) => {
    expect(numeral(symbol, "A minor")).toBe(expected);
  });

  it("labels the minor-key IV as dorian, not as V/v", () => {
    const a = analyzeChord("D", "A minor");
    expect(a.borrowedFrom).toBe("dorian");
    expect(a.isDiatonic).toBe(false);
  });
});

describe("functions", () => {
  it("classifies diatonic functions in major", () => {
    expect(fn("C")).toBe("T");
    expect(fn("Em")).toBe("T");
    expect(fn("Am")).toBe("T");
    expect(fn("Dm")).toBe("S");
    expect(fn("F")).toBe("S");
    expect(fn("G7")).toBe("D");
    expect(fn("Bdim")).toBe("D");
  });

  it("classifies borrowed functions", () => {
    expect(fn("Fm")).toBe("S"); // iv
    expect(fn("Eb")).toBe("T"); // bIII
    expect(fn("Bb")).toBe("S"); // bVII
  });

  it("classifies functions in minor", () => {
    expect(fn("Am", "A minor")).toBe("T");
    expect(fn("Bdim", "A minor")).toBe("S");
    expect(fn("F", "A minor")).toBe("S");
    expect(fn("E", "A minor")).toBe("D");
    expect(fn("G", "A minor")).toBe("D");
  });

  it("detects D -> S retrogression only", () => {
    const a = (s: string) => analyzeChord(s, "C major");
    expect(isRetrogression(a("G7"), a("F"))).toBe(true); // V -> IV
    expect(isRetrogression(a("G7"), a("Dm"))).toBe(true); // V -> ii
    expect(isRetrogression(a("G7"), a("C"))).toBe(false); // V -> I
    expect(isRetrogression(a("Dm"), a("G7"))).toBe(false); // ii -> V
    expect(isRetrogression(a("G7"), a("Am"))).toBe(false); // V -> vi
  });

  it("does not call an applied dominant resolving to its target a retrogression", () => {
    const a = (s: string) => analyzeChord(s, "C major");
    expect(isRetrogression(a("C7"), a("F"))).toBe(false); // V7/IV -> IV
    expect(isRetrogression(a("D7"), a("G"))).toBe(false); // V7/V -> V
  });
});

describe("cadence", () => {
  it.each([
    ["G7", "C", "PAC"],
    ["G", "C", "PAC"],
    ["G/B", "C", "IAC"],
    ["G7/B", "C", "IAC"],
    ["F", "C", "PC"],
    ["G", "Am", "DC"],
    ["Dm", "G", "HC"],
    ["Am", "F", "none"],
  ] as [string, string, string][])("%s -> %s = %s", (a, b, expected) => {
    expect(cadence(a, b)).toBe(expected);
  });

  it("detects a minor-key authentic cadence", () => {
    expect(cadence("E7", "Am", "A minor")).toBe("PAC");
  });

  it("treats I7 as a tonic (blues)", () => {
    expect(cadence("G7", "C7")).toBe("PAC");
  });
});

describe("realization (numerals -> chords)", () => {
  it("realizes a major progression", () => {
    expect(realizeNumerals(["IVmaj7", "V7", "iii7", "vi"], "C major")).toEqual(["Fmaj7", "G7", "Em7", "Am"]);
    expect(realizeNumerals(["Imaj7", "vi7", "ii7", "V7"], "C major")).toEqual(["Cmaj7", "Am7", "Dm7", "G7"]);
    expect(realizeNumerals(["vi", "IV", "V", "I"], "C major")).toEqual(["Am", "F", "G", "C"]);
  });

  it("realizes borrowed and chromatic numerals", () => {
    expect(realizeNumeral("bVII", "C major")).toBe("Bb");
    expect(realizeNumeral("iv", "C major")).toBe("Fm");
    expect(realizeNumeral("bII", "C major")).toBe("Db");
    expect(realizeNumeral("V7", "A minor")).toBe("E7");
    expect(realizeNumeral("bVII", "Eb major")).toBe("Db");
  });

  it("round-trips progression cards", () => {
    const cards: [string[], string][] = [
      [["Imaj7", "vi7", "ii7", "V7"], "C major"],
      [["IVmaj7", "V7", "iii7", "vi"], "C major"],
      [["vi", "IV", "V", "I"], "C major"],
      [["I", "V", "vi", "IV"], "Eb major"],
      [["ii7", "V7", "Imaj7"], "F major"],
      [["i", "iv", "V7", "i"], "A minor"],
    ];
    for (const [numerals, key] of cards) {
      const symbols = realizeNumerals(numerals, key);
      symbols.forEach((symbol, i) => {
        expect(analyzeChord(symbol, key).numeral).toBe(numerals[i]);
      });
    }
  });
});

describe("invariants", () => {
  it("round-trips every diatonic chord in all 24 keys", () => {
    for (let root = 0; root < 12; root++) {
      for (const mode of ["major", "minor"] as const) {
        const key: KeyContext = { root, mode };
        for (let degree = 1; degree <= 7; degree++) {
          const symbol = degreeChord(key, degree, diatonicTriad(key, degree));
          const a = analyzeChord(symbol, key);
          expect({ symbol, degree: a.degree, accidental: a.accidental, diatonic: a.isDiatonic }).toEqual({
            symbol,
            degree,
            accidental: 0,
            diatonic: true,
          });
        }
      }
    }
  });

  it("parses numerals back to degree and quality", () => {
    expect(parseNumeral("bVII")).toEqual({ degree: 7, accidental: -1, quality: "maj" });
    expect(parseNumeral("vii°")).toEqual({ degree: 7, accidental: 0, quality: "dim" });
    expect(parseNumeral("iiø7")).toEqual({ degree: 2, accidental: 0, quality: "m7b5" });
    expect(() => parseNumeral("V7/V")).toThrow();
    expect(() => parseNumeral("X")).toThrow();
  });
});
