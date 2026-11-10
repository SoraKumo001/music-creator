import { describe, expect, it } from "vitest";
import { assemble } from "../src/compose";
import { normalizeScore } from "../src/normalize";
import { keyAtBeat, PlanSchema, resolveSections } from "../src/plan";
import { melodyMessages } from "../src/prompt";
import type { Note } from "../src/score";
import { generateBass, generateComp } from "../src/theory/accompaniment";
import { generateDrums } from "../src/theory/drums";
import { polishMelody, scoreMelody, type MelodyContext } from "../src/theory/melody";
import { repairPlan } from "../src/theory/repair";
import { validatePlan } from "../src/theory/validate";

const mk = (chords: [number, string][], extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({ bpm: 100, key: "C major", chords, ...extra });

describe("keyChanges", () => {
  it("resolves the key at a beat", () => {
    const plan = mk([[0, "C"]], { keyChanges: [{ bar: 4, key: "G major" }] });
    expect(keyAtBeat(plan, 0, 4)).toBe("C major");
    expect(keyAtBeat(plan, 15.9, 4)).toBe("C major");
    expect(keyAtBeat(plan, 16, 4)).toBe("G major");
    expect(keyAtBeat(mk([[0, "C"]]), 99, 4)).toBe("C major");
  });

  it("repair closes in the final region's key and keeps keyChanges", () => {
    const plan = mk(
      [[0, "C"], [8, "G"], [16, "D"], [24, "A"]], // A は G major の V/V。終止は弱い
      { keyChanges: [{ bar: 4, key: "G major" }, { bar: 99, key: "X" }] },
    );
    const { plan: repaired } = repairPlan(plan, 8);
    expect(repaired.chords.at(-1)![1]).toBe("G");
    expect(repaired.keyChanges).toEqual([{ bar: 4, key: "G major" }]);
  });

  it("validate reports MODULATION as info", () => {
    const plan = mk([[0, "C"], [8, "G"], [16, "G"], [24, "C"]], {
      keyChanges: [{ bar: 2, key: "G major" }],
    });
    const mod = validatePlan(plan, 4).find((i) => i.code === "MODULATION");
    expect(mod?.severity).toBe("info");
    expect(mod?.beat).toBe(8);
  });

  it("melody scoring uses the local key", () => {
    const chords = [[0, "C"], [8, "G"], [16, "C"], [24, "G"]] as [number, string][];
    const base: MelodyContext = { key: "C major", chords: chords.map(([start, symbol]) => ({ start, symbol })), bars: 8, beatsPerBar: 4 };
    // F# は C major では調外、G major では調内 (bars 3-4 = beats 8-15)
    const notes: Note[] = [[66, 8, 1], [69, 9, 1], [71, 10, 1], [67, 12, 2]].map(([pitch, start, duration]) => ({ pitch: pitch!, start: start!, duration: duration!, velocity: 90 }));
    const plain = scoreMelody(notes, base);
    const mod = scoreMelody(notes, { ...base, keyChanges: [{ bar: 2, key: "G major" }] });
    expect(mod.parts.inScale).toBeGreaterThan(plain.parts.inScale!);
    // polish も新調で吸着する (F# を残す)
    const polished = polishMelody([{ pitch: 66, start: 8, duration: 2, velocity: 90 }], { ...base, keyChanges: [{ bar: 2, key: "G major" }] });
    expect(polished[0]!.pitch % 12).toBe(6);
  });
});

describe("form roles", () => {
  it("resolveSections keeps role and swell", () => {
    const plan = mk([[0, "C"]], {
      sections: [{ name: "A", bars: 4, role: "verse" }, { name: "B", bars: 4, role: "chorus", swell: 1 }],
    });
    const secs = resolveSections(plan, 8, 4);
    expect(secs.map((s) => s.role)).toEqual(["verse", "chorus"]);
    expect(secs[1]!.swell).toBe(1);
  });

  it("validate flags a long song without chorus as FORM info", () => {
    const plan = mk([[0, "C"], [8, "G"], [16, "G"], [24, "C"], [28, "G"]], {
      sections: [{ name: "A", bars: 4, role: "verse" }, { name: "B", bars: 4, role: "bridge" }],
    });
    expect(validatePlan(plan, 8).find((i) => i.code === "FORM")?.severity).toBe("info");
    const withChorus = mk([[0, "C"]], {
      sections: [{ name: "A", bars: 4, role: "verse" }, { name: "B", bars: 4, role: "chorus" }],
    });
    expect(validatePlan(withChorus, 8).some((i) => i.code === "FORM")).toBe(false);
  });

  it("break sections stay sparse", () => {
    const chords = [[0, "C"], [4, "G"], [8, "Am"], [12, "G"]] as [number, string][];
    const events = chords.map(([start, symbol]) => ({ start, symbol }));
    const mkSecs = (role: "other" | "break") =>
      resolveSections(mk(chords, { sections: [{ name: "X", bars: 4, comp: "strum", bass: "eighths", drums: "rock", role }] }), 4, 4);
    const full = mkSecs("other");
    const brk = mkSecs("break");
    const a = { sections: full, totalBeats: 16, beatsPerBar: 4 } as const;
    const b = { sections: brk, totalBeats: 16, beatsPerBar: 4 } as const;
    expect(generateComp(events, { ...a }).length).toBeGreaterThan(generateComp(events, { ...b }).length);
    expect(generateBass(events, { ...a }).length).toBeGreaterThan(generateBass(events, { ...b }).length);
    expect(generateDrums(full, 4).length).toBeGreaterThan(generateDrums(brk, 4).length);
    expect(generateComp(events, { ...b }).length).toBeGreaterThan(0);
  });

  it("swell changes velocities within a section", () => {
    const chords = [[0, "C"], [4, "G"], [8, "Am"], [12, "G"]] as [number, string][];
    const events = chords.map(([start, symbol]) => ({ start, symbol }));
    const flat = resolveSections(mk(chords, { sections: [{ name: "X", bars: 4, comp: "strum", swell: 0 }] }), 4, 4);
    const up = resolveSections(mk(chords, { sections: [{ name: "X", bars: 4, comp: "strum", swell: 1 }] }), 4, 4);
    const a = generateComp(events, { sections: flat, totalBeats: 16, beatsPerBar: 4 });
    const c = generateComp(events, { sections: up, totalBeats: 16, beatsPerBar: 4 });
    expect(c.map((n) => n.velocity)).not.toEqual(a.map((n) => n.velocity));
  });

  it("supports syncopation and pedal styles", () => {
    const chords = [[0, "C"], [4, "G"]] as [number, string][];
    const events = chords.map(([start, symbol]) => ({ start, symbol }));
    const secs = resolveSections(
      mk(chords, { sections: [{ name: "X", bars: 2, comp: "syncopation", bass: "pedal" }] }), 2, 4);
    const arr = { sections: secs, totalBeats: 8, beatsPerBar: 4 } as const;
    expect(generateComp(events, arr).length).toBeGreaterThan(0);
    expect(generateBass(events, arr).length).toBeGreaterThan(0);
  });

  it("supports waltz, halftime and shuffle drum patterns", () => {
    const secs = (drums: string) =>
      resolveSections(mk([[0, "C"]], { sections: [{ name: "X", bars: 4, drums }] }), 4, 3);
    expect(generateDrums(secs("waltz"), 3).length).toBeGreaterThan(0);
    expect(Math.max(...generateDrums(secs("waltz"), 3).map((n) => n.start))).toBeLessThan(12);
    for (const p of ["halftime", "shuffle"]) {
      const s4 = resolveSections(mk([[0, "C"]], { sections: [{ name: "X", bars: 2, drums: p }] }), 2, 4);
      expect(generateDrums(s4, 4).length).toBeGreaterThan(0);
    }
  });
});

describe("swing", () => {
  it("delays off-beat 8ths except drums", () => {
    const score = {
      title: "t", bpm: 100, timeSignature: [4, 4] as [number, number], key: "C major",
      tracks: [
        { name: "M", program: 0, channel: 0, notes: [{ pitch: 60, start: 0.5, duration: 0.5, velocity: 90 }] },
        { name: "D", program: 0, channel: 9, notes: [{ pitch: 42, start: 0.5, duration: 0.25, velocity: 90 }] },
      ],
    };
    const out = normalizeScore(score, 4, { swing: 0.4 });
    expect(out.tracks[0]!.notes[0]!.start).toBeGreaterThan(0.5);
    expect(out.tracks[1]!.notes[0]!.start).toBe(0.5);
    const plain = normalizeScore(score, 4);
    expect(plain.tracks[0]!.notes[0]!.start).toBe(0.5);
  });
});

describe("melody ranges and counter-melody", () => {
  const plan = mk([[0, "C"], [16, "G"], [28, "C"]], {
    sections: [{ name: "A", bars: 4 }, { name: "B", bars: 4 }],
  });
  const sections = resolveSections(plan, 8, 4);

  it("emits a range-limited prompt", () => {
    const text = melodyMessages("x", plan, sections, 8, 4, { fromBar: 4, toBar: 8 })[1]!.content;
    expect(text).toContain("bars 5-8");
    expect(text).toContain("beats 0-16");
    expect(text).not.toContain("final bar, land on the tonic");
  });

  it("asks for a counter-line when counterTo is given", () => {
    const msgs = melodyMessages("x", plan, sections, 8, 4, {
      fromBar: 0, toBar: 4, counterTo: [{ pitch: 72, start: 0, duration: 1 }],
    });
    expect(msgs[0]!.content).toContain("counter-line");
    expect(msgs[1]!.content).toContain("counter-melody");
  });

  it("assemble adds a counter track", () => {
    const score = assemble(plan, sections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], 8, {
      counter: [{ pitch: 67, start: 0, duration: 1, velocity: 80 }],
    });
    expect(score.tracks.map((t) => t.name)).toContain("Counter");
  });
});
