import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMidi } from "../src/midi/parseMidi";
import { scoreToMidi } from "../src/midi/toMidi";
import { ScoreSchema } from "../src/score";

describe("parseMidi", () => {
  it("round-trips a Score written by scoreToMidi", () => {
    const score = ScoreSchema.parse({
      title: "t", bpm: 120, timeSignature: [4, 4], key: "C major",
      tracks: [
        { name: "Melody", program: 0, channel: 0, notes: [
          { pitch: 60, start: 0, duration: 1, velocity: 100 },
          { pitch: 64, start: 1, duration: 0.5, velocity: 90 },
          { pitch: 67, start: 4, duration: 2, velocity: 80 },
        ] },
        { name: "Drums", program: 0, channel: 9, notes: [{ pitch: 36, start: 0, duration: 0.25, velocity: 110 }] },
      ],
    });
    const parsed = parseMidi(scoreToMidi(score));
    expect(parsed.format).toBe(1);
    expect(parsed.tracks).toHaveLength(2);
    const notes = parsed.tracks[0]!.notes;
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(notes[0]!.start).toBeCloseTo(0, 3);
    // 120BPM なので 1 拍 = 0.5 秒
    expect(notes[1]!.start).toBeCloseTo(0.5, 2);
    expect(notes[2]!.start).toBeCloseTo(2, 2);
    expect(notes[0]!.velocity).toBe(100);
    expect(parsed.tempos[0]!.bpm).toBeCloseTo(120, 1);
    expect(parsed.timeSignatures[0]).toMatchObject({ numerator: 4, denominator: 4 });
    expect(parsed.tracks[1]!.notes[0]!.channel).toBe(9);
  });

  it("rejects non-MIDI data", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it("puts each track's program on the same channel as its notes", () => {
    const score = ScoreSchema.parse({
      bpm: 120,
      tracks: [
        { name: "Lead", program: 81, channel: 0, notes: [{ pitch: 72, start: 0, duration: 1, velocity: 90 }] },
        { name: "Chords", program: 29, channel: 1, notes: [{ pitch: 60, start: 0, duration: 1, velocity: 80 }] },
        { name: "Bass", program: 33, channel: 2, notes: [{ pitch: 40, start: 0, duration: 1, velocity: 85 }] },
        { name: "Drums", program: 0, channel: 9, notes: [{ pitch: 36, start: 0, duration: 0.25, velocity: 100 }] },
      ],
    });
    const parsed = parseMidi(scoreToMidi(score));
    // ノートのチャンネルと、その音色が一致していること (別チャンネルだと既定音色で鳴る)
    const pairs = parsed.tracks.map((t) => [t.notes[0]!.channel, t.notes[0]!.program] as const);
    expect(pairs).toEqual([[0, 81], [1, 29], [2, 33], [9, 0]]);
    expect(new Set(parsed.tracks.flatMap((t) => t.notes.map((n) => n.program))).size).toBe(4);
  });

  it("parses the real corpus sample when present", () => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync("out/corpus/edf.mid"));
    } catch {
      return; // サンプル未取得の環境ではスキップ
    }
    const midi = parseMidi(bytes);
    expect(midi.division).toBeGreaterThan(0);
    expect(midi.tracks.length).toBeGreaterThan(0);
    const total = midi.tracks.reduce((n, t) => n + t.notes.length, 0);
    expect(total).toBeGreaterThan(50);
    expect(midi.durationSeconds).toBeGreaterThan(5);
  });
});
