import { describe, expect, it } from "vitest";
import { assemble } from "../src/compose";
import { PlanSchema, resolveSections } from "../src/plan";
import type { Note } from "../src/score";
import { generateComp, type Arrangement } from "../src/theory/accompaniment";
import { colorPlan } from "../src/theory/color";
import { generateArp, generateHarmony, generatePad } from "../src/theory/texture";
import { validatePlan } from "../src/theory/validate";

const mk = (chords: [number, string][], extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({ bpm: 120, key: "C major", chords, ...extra });

const melody: Note[] = [
  { pitch: 72, start: 0, duration: 1, velocity: 100 },
  { pitch: 74, start: 4, duration: 2, velocity: 100 },
  { pitch: 76, start: 8, duration: 1, velocity: 100 },
  { pitch: 72, start: 12, duration: 2, velocity: 100 },
];

describe("texture", () => {
  const plan = mk([[0, "C"], [8, "Am"], [16, "F"], [24, "G"]], {
    sections: [
      { name: "A", bars: 4, comp: "block", energy: 2 },
      { name: "B", bars: 4, comp: "strum", energy: 3 },
    ],
  });
  const sections = resolveSections(plan, 8, 4);
  const events = plan.chords.map(([start, symbol]) => ({ start, symbol }));
  const arr: Arrangement = { sections, totalBeats: 32, beatsPerBar: 4 };

  it("pad adds sustained chord notes in energy >= 2 sections", () => {
    const pad = generatePad(events, arr);
    expect(pad.length).toBeGreaterThan(0);
    for (const n of pad) {
      expect(n.pitch).toBeGreaterThanOrEqual(60);
      expect(n.pitch).toBeLessThanOrEqual(91);
    }
    // intro (energy 1) だけのアレンジでは鳴らない
    const intro = resolveSections(
      mk([[0, "C"], [8, "G"]], { sections: [{ name: "I", bars: 4, energy: 1 }] }), 4, 4);
    expect(generatePad(events, { sections: intro, totalBeats: 16, beatsPerBar: 4 })).toHaveLength(0);
  });

  it("arp uses 16ths in high energy and stays inside the song", () => {
    const arp = generateArp(events, arr);
    expect(arp.length).toBeGreaterThan(8);
    expect(Math.max(...arp.map((n) => n.start + n.duration))).toBeLessThanOrEqual(32.001);
    // energy 3 のセクションは16分 (0.25 刻み) が出る
    const b = arp.filter((n) => n.start >= 16);
    expect(b.some((n) => Math.abs((n.start % 1) - 0.25) < 1e-6 || Math.abs((n.start % 1) - 0.75) < 1e-6)).toBe(true);
  });

  it("harmony adds a diatonic third below long notes", () => {
    const h = generateHarmony(melody, plan, 4);
    expect(h.length).toBeGreaterThan(0);
    for (const n of h) expect(n.pitch).toBeLessThan(72 + 1);
    // 短い音には付けない
    const short = generateHarmony([{ pitch: 72, start: 0, duration: 0.25, velocity: 90 }], plan, 4);
    expect(short).toHaveLength(0);
  });

  it("assemble can add texture voices on distinct channels", () => {
    const score = assemble(plan, sections, melody, 8, { texture: true, arp: true });
    const names = score.tracks.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Harmony", "Pad", "Arp", "Chords", "Bass", "Drums"]));
    const channels = score.tracks.map((t) => t.channel);
    expect(new Set(channels).size).toBe(channels.length);
    // 既定では従来通り
    const plain = assemble(plan, sections, melody, 8);
    expect(plain.tracks.map((t) => t.name)).toEqual([plan.melodyName, "Chords", "Bass", "Drums"]);
  });
});

describe("colorPlan", () => {
  it("adds borrowed or secondary chords without breaking validation", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "F"], [24, "G"], [28, "E7"], [32, "Am"], [36, "Dm"], [40, "Am"]]);
    const before = validatePlan(plan, 12).filter((i) => i.severity === "error").length;
    const { plan: colored, changes, reverted } = colorPlan(plan, 12, 7, { strength: 1, maxChanges: 3 });
    expect(reverted).toBe(false);
    expect(changes).toBeGreaterThan(0);
    const after = validatePlan(colored, 12).filter((i) => i.severity === "error").length;
    expect(after).toBeLessThanOrEqual(before);
    // 元プランは破壊しない
    expect(plan.chords).toHaveLength(8);
  });

  it("is deterministic for the same seed and inert at strength 0", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "F"], [24, "G"], [28, "E7"], [32, "Am"]]);
    const a = colorPlan(plan, 8, 42, { strength: 1, maxChanges: 2 });
    const b = colorPlan(plan, 8, 42, { strength: 1, maxChanges: 2 });
    expect(a.plan.chords).toEqual(b.plan.chords);
    const none = colorPlan(plan, 8, 42, { strength: 0 });
    expect(none.changes).toBe(0);
    expect(none.plan.chords).toEqual(plan.chords);
  });

  it("keeps the first and last two bars untouched", () => {
    const plan = mk([[0, "C"], [8, "Am"], [16, "F"], [24, "G"], [32, "Am"]]);
    const { plan: colored } = colorPlan(plan, 10, 3, { strength: 1, maxChanges: 10 });
    const beatsPerBar = 4;
    const total = 10 * beatsPerBar;
    for (const [beat, symbol] of colored.chords) {
      const original = plan.chords.find(([b]) => b === beat)![1];
      if (beat < 2 * beatsPerBar || beat >= total - 2 * beatsPerBar) expect(symbol).toBe(original);
    }
  });
});

describe("texture does not affect harmony generation", () => {
  it("chords track is unchanged by texture options", () => {
    const plan = mk([[0, "C"], [8, "G"]]);
    const sections = resolveSections(plan, 4, 4);
    const events = plan.chords.map(([start, symbol]) => ({ start, symbol }));
    const arr: Arrangement = { sections, totalBeats: 16, beatsPerBar: 4 };
    const plain = assemble(plan, sections, melody, 4);
    const textured = assemble(plan, sections, melody, 4, { texture: true });
    const chordsOf = (s: typeof plain) => s.tracks.find((t) => t.name === "Chords")!.notes;
    expect(chordsOf(textured)).toEqual(chordsOf(plain));
    void generateComp(events, arr);
  });
});
