import { describe, expect, it } from "vitest";
import { assemble, parseCompactNotes } from "../src/compose";
import { scoreToMidi } from "../src/midi/toMidi";
import { normalizeScore } from "../src/normalize";
import { PlanSchema, resolveEnding, resolveSections } from "../src/plan";
import { melodyMessages } from "../src/prompt";
import { ScoreSchema, type Note } from "../src/score";
import { clampToRange, parseKey } from "../src/theory";
import { generateBass, generateComp, type Arrangement } from "../src/theory/accompaniment";
import { generateDrums } from "../src/theory/drums";
import { parseChord, voice } from "../src/theory/harmony";
import { polishMelody, scoreMelody, type MelodyContext } from "../src/theory/melody";

const sample = ScoreSchema.parse({
  bpm: 100,
  tracks: [
    { program: 0, channel: 0, notes: [{ pitch: 60, start: 0, duration: 1.01 }, { pitch: 4, start: 100, duration: 1 }] },
    { program: 0, channel: 9, notes: [{ pitch: 36, start: 0, duration: 0.5 }] },
  ],
});

describe("pipeline", () => {
  it("normalizes: drops notes past the end", () => {
    expect(normalizeScore(sample, 8).tracks[0]!.notes).toHaveLength(1);
  });
  it("writes a valid SMF header", () => {
    const midi = scoreToMidi(normalizeScore(sample, 8));
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe("MThd");
  });
  it("theory helpers", () => {
    expect(parseKey("A minor")).toEqual({ root: 9, scale: "minor" });
    expect(clampToRange(10, 0, false)).toBeGreaterThanOrEqual(21);
  });
  it("parses compact notes", () => {
    expect(parseCompactNotes({ notes: [[60, 0, 1, 80], [62, 1, 1]] })[0]).toEqual({ pitch: 60, start: 0, duration: 1, velocity: 80 });
    expect(() => parseCompactNotes({})).toThrow();
  });
});

const plan = PlanSchema.parse({
  bpm: 90,
  key: "C major",
  chords: [[0, "Cmaj7"], [4, "Am7"], [8, "Dm7"], [12, "G7"], [16, "Fmaj7"], [20, "G7"], [24, "Cmaj7"], [28, "C"]],
  sections: [
    { name: "intro", bars: 2, comp: "pad", bass: "none", drums: "none", energy: 1 },
    { name: "A", bars: 4, comp: "arpeggio", bass: "walking", drums: "lofi", energy: 2 },
    { name: "B", bars: 4, comp: "strum", bass: "eighths", drums: "rock", energy: 3 },
  ],
});
const BARS = 8;
const sections = resolveSections(plan, BARS, 4);
const events = plan.chords.map(([start, symbol]) => ({ start, symbol }));
const arr: Arrangement = { sections, totalBeats: 32, beatsPerBar: 4 };
const inRange = (ns: Note[], s: number, e: number) => ns.filter((n) => n.start >= s && n.start < e);

describe("harmony", () => {
  it("parses chord symbols", () => {
    expect(parseChord("Fmaj7").tones).toEqual([9, 4, 5, 0]);
    expect(parseChord("Dm7").tones.slice(0, 2)).toEqual([5, 0]);
    expect(parseChord("C/E").bass).toBe(4);
    expect(() => parseChord("H#?")).toThrow();
  });
  it("voices within range", () => {
    const a = voice(parseChord("Cmaj7"), 62);
    expect(a).toHaveLength(4);
    for (const p of a) { expect(p).toBeGreaterThanOrEqual(53); expect(p).toBeLessThanOrEqual(79); }
  });
});

describe("sections", () => {
  it("fits sections to the song length", () => {
    expect(sections.map((s) => [s.name, s.startBar, s.bars])).toEqual([["intro", 0, 2], ["A", 2, 4], ["B", 6, 2]]);
    const short = resolveSections(PlanSchema.parse({ bpm: 90, chords: [[0, "C"]], sections: [{ name: "A", bars: 2 }] }), 8, 4);
    expect(short[0]!.bars).toBe(8);
    expect(resolveSections(PlanSchema.parse({ bpm: 90, chords: [[0, "C"]] }), 4, 4)).toHaveLength(1);
  });
  it("comp follows each section's style and stays in bounds", () => {
    const n = generateComp(events, arr);
    expect(Math.max(...n.map((x) => x.start + x.duration))).toBeLessThanOrEqual(32.001);
    // intro(pad)は1小節あたり和音1回、A(arpeggio)は8分で刻む
    expect(new Set(inRange(n, 0, 4).map((x) => x.start)).size).toBe(1);
    expect(new Set(inRange(n, 8, 12).map((x) => x.start)).size).toBe(8);
    // energy 3 は energy 1 より強い
    const avg = (xs: Note[]) => xs.reduce((a, x) => a + x.velocity, 0) / xs.length;
    expect(avg(inRange(n, 24, 28))).toBeGreaterThan(avg(inRange(n, 0, 8)));
    // 最終小節は 1 拍目と中間拍の 2 回で締める
    expect(new Set(inRange(n, 28, 32).map((x) => x.start)).size).toBe(2);
  });
  it("bass is silent in 'none' sections and in range elsewhere", () => {
    const n = generateBass(events, arr);
    expect(inRange(n, 0, 8)).toHaveLength(0);
    expect(inRange(n, 8, 24).length).toBeGreaterThan(8);
    for (const x of n) { expect(x.pitch).toBeGreaterThanOrEqual(34); expect(x.pitch).toBeLessThanOrEqual(62); }
    expect(inRange(n, 28, 32)).toHaveLength(2);
  });
  it("drums: none in intro, fill before section change, simple ending", () => {
    const n = generateDrums(sections, 4);
    expect(inRange(n, 0, 8)).toHaveLength(0);
    expect(inRange(n, 23, 24).filter((x) => x.pitch === 38 || x.pitch === 45 || x.pitch === 50)).toHaveLength(4);
    // 終止は 1 拍目と中間拍の 2 回 (kick + crash / snare + kick + crash)
    expect(inRange(n, 28, 32)).toHaveLength(5);
    expect(Math.max(...n.map((x) => x.start))).toBeLessThan(32);
  });
  it("drums: adds groove micro-variations when seed is provided", () => {
    const withSeed = generateDrums(sections, 4, "button", false, { seed: 42 });
    expect(withSeed.length).toBeGreaterThan(0);
    // seed指定時はベロシティやゴーストノート等の人間味バリエーションが加わる
    expect(withSeed.some((n) => n.velocity !== 105 && n.velocity !== 100)).toBe(true);
  });
});

describe("melody", () => {
  const ctx: MelodyContext = { key: "C major", chords: events, bars: BARS, beatsPerBar: 4 };
  const mk = (a: number[][]): Note[] => a.map(([pitch, start, duration]) => ({ pitch: pitch!, start: start!, duration: duration!, velocity: 90 }));
  // コードトーン中心・順次進行・リズムに変化のある旋律
  const good = mk([
    [64, 0, 1], [65, 1, 0.5], [67, 1.5, 1.5], [72, 4, 1], [71, 5, 0.5], [69, 5.5, 1.5],
    [65, 8, 1], [67, 9, 0.5], [69, 9.5, 1.5], [67, 12, 1], [65, 13, 0.5], [62, 13.5, 1.5],
    [69, 16, 1], [67, 17, 1], [65, 18, 2], [67, 20, 1.5], [71, 22, 0.5], [74, 22.5, 1],
    [72, 24, 1], [71, 25, 0.5], [67, 25.5, 1.5], [72, 28, 4],
  ]);
  // 調外音だらけ・跳躍だらけ・単調なリズム
  const bad = mk(Array.from({ length: 32 }, (_, i) => [61 + (i % 2) * 18, i, 1]));

  it("scores a musical melody above a poor one", () => {
    const g = scoreMelody(good, ctx);
    const b = scoreMelody(bad, ctx);
    expect(g.total).toBeGreaterThan(b.total + 20);
    expect(g.total).toBeGreaterThan(65);
  });
  it("polish makes it monophonic and fixes long out-of-key notes", () => {
    const p = polishMelody(mk([[61, 0, 2], [64, 0, 2], [66, 1, 2], [40, 3, 1], [70, 40, 1]]), ctx);
    expect(p.map((n) => n.start)).toEqual([0, 1, 3]);
    expect(p[0]!.pitch).toBe(64); // 同時発音は高い方
    expect(p[0]!.duration).toBe(1); // 次の音に重ならない
    expect([65, 67]).toContain(p[1]!.pitch); // F# -> スケール内
    expect(p[2]!.pitch).toBeGreaterThanOrEqual(55);
  });
  it("caps the final note so the ending is not one long sustain", () => {
    const p = polishMelody(mk([[72, 28, 4]]), ctx);
    expect(p[0]!.duration).toBeLessThanOrEqual(2);
  });
  it("shapes velocity dynamically for musical expression", () => {
    // 平坦なベロシティ(80固定)でも強拍やピッチ高低に応じて抑揚がつく
    const flat = mk([[60, 0, 1], [62, 0.5, 0.5], [72, 1, 1], [64, 2, 1]]);
    const p = polishMelody(flat, ctx);
    const vels = p.map((n) => n.velocity);
    expect(new Set(vels).size).toBeGreaterThan(1);
    // 高音かつ強拍の音は弱拍の音よりベロシティが高い
    expect(p.find((n) => n.start === 0)!.velocity).toBeGreaterThan(p.find((n) => n.start === 0.5)!.velocity);
  });
});

describe("assemble / prompt", () => {
  it("builds four tracks on distinct channels", () => {
    const score = assemble(plan, sections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], BARS);
    expect(score.tracks.map((t) => t.name)).toEqual(["Melody", "Chords", "Bass", "Drums"]);
    expect(new Set(score.tracks.map((t) => t.channel)).size).toBe(4);
    expect(String.fromCharCode(...scoreToMidi(normalizeScore(score, BARS)).slice(0, 4))).toBe("MThd");
  });
  it("melody prompt lists the chord of every bar, carrying over held chords", () => {
    const p2 = PlanSchema.parse({ bpm: 90, chords: [[0, "C"], [6, "G"]] });
    const text = melodyMessages("x", p2, resolveSections(p2, 3, 4), 3, 4)[1]!.content;
    expect(text).toContain("bar 1 (beats 0-4): C@0");
    expect(text).toContain("bar 2 (beats 4-8): C@4 G@6");
    expect(text).toContain("bar 3 (beats 8-12): G@8");
  });
});

describe("ending", () => {
  const base = { sections, totalBeats: 32, beatsPerBar: 4 };
  const finalStarts = (n: Note[]) => new Set(inRange(n, 28, 32).map((x) => x.start)).size;
  it("derives an ending from tempo and key when unspecified", () => {
    expect(resolveEnding(PlanSchema.parse({ bpm: 130, chords: [[0, "C"]] }))).toBe("hits");
    expect(resolveEnding(PlanSchema.parse({ bpm: 80, chords: [[0, "C"]] }))).toBe("ring");
    expect(resolveEnding(PlanSchema.parse({ bpm: 100, key: "A minor", chords: [[0, "C"]] }))).toBe("stop");
    expect(resolveEnding(PlanSchema.parse({ bpm: 100, chords: [[0, "C"]] }))).toBe("button");
    expect(resolveEnding(PlanSchema.parse({ bpm: 100, ending: "ring", chords: [[0, "C"]] }))).toBe("ring");
  });

  it("plays a different final-bar pattern for each style", () => {
    const starts = (ending: "button" | "stop" | "ring" | "hits") => finalStarts(generateComp(events, { ...base, ending }));
    expect(starts("button")).toBe(2);
    expect(starts("stop")).toBe(1);
    expect(starts("ring")).toBe(1);
    expect(starts("hits")).toBe(4);
  });

  it("uses the ending style for drums", () => {
    const finalCount = (ending: "button" | "stop" | "ring" | "hits") =>
      inRange(generateDrums(sections, 4, ending), 28, 32).length;
    expect(finalCount("stop")).toBe(2);
    expect(finalCount("ring")).toBe(2);
    expect(finalCount("button")).toBe(5);
    expect(finalCount("hits")).toBe(6);
  });
});

describe("loop mode", () => {
  it("keeps the section groove and fills into the loop point", () => {
    const loopPlan = { ...plan, loop: true };
    const loopSections = resolveSections(loopPlan, BARS, 4);
    const score = assemble(loopPlan, loopSections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], BARS);
    const chords = score.tracks.find((t) => t.name === "Chords")!.notes;
    // 最終小節は終止ではなくセクションの comp (strum) のまま
    expect(new Set(inRange(chords, 28, 32).map((n) => n.start)).size).toBe(4);
    const drums = score.tracks.find((t) => t.name === "Drums")!.notes;
    // 最後の 1 拍にフィルが入り、次の周へ渡す
    expect(inRange(drums, 31, 32).length).toBeGreaterThanOrEqual(4);
  });
});

describe("orchestra mode", () => {
  it("builds an orchestral score when requested", () => {
    const orch = { ...plan, ensemble: "orchestra" as const };
    const orchSections = resolveSections(orch, BARS, 4);
    const score = assemble(orch, orchSections, [{ pitch: 72, start: 0, duration: 1, velocity: 90 }], BARS);
    expect(score.tracks.length).toBeGreaterThan(4);
    expect(score.tracks.map((t) => t.name)).toContain("Violin I");
    expect(String.fromCharCode(...scoreToMidi(normalizeScore(score, BARS)).slice(0, 4))).toBe("MThd");
  });
});
