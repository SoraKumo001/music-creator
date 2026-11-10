import { describe, expect, it } from "vitest";
import { PlanSchema } from "../src/plan";
import { parseChord } from "../src/theory/harmony";
import { parseKeyName } from "../src/theory/key";
import { transposePlanToMode, planModeConflict } from "../src/theory/mode";
import { analyzeChord } from "../src/theory/roman";

const plan = (extra: Record<string, unknown> = {}) =>
  PlanSchema.parse({
    bpm: 132,
    key: "A minor",
    chords: [[0, "Am"], [8, "F"], [16, "C"], [24, "G"]],
    sections: [
      { name: "A", bars: 4, role: "verse" },
      { name: "B", bars: 4, role: "chorus" },
    ],
    ...extra,
  });

describe("transposePlanToMode", () => {
  it("returns the plan unchanged when the mode already matches", () => {
    const p = plan();
    expect(transposePlanToMode(p, "minor")).toBe(p);
    const major = plan({ key: "C major", chords: [[0, "C"]] });
    expect(transposePlanToMode(major, "major")).toBe(major);
  });

  it("keeps the tonic and re-realizes the progression in the parallel major", () => {
    const out = transposePlanToMode(plan(), "major");
    expect(out.key).toBe("A major");
    expect(parseKeyName(out.key).mode).toBe("major");
    // i -> I, VI -> vi, III -> iii, VII -> vii°
    expect(out.chords.map(([, s]) => s)).toEqual(["A", "F#m", "C#m", "G#dim"]);
    // 出力コードはすべて解析できる
    for (const [, s] of out.chords) expect(() => parseChord(s)).not.toThrow();
    // 主音は A のまま
    expect(parseKeyName(out.key).root).toBe(9);
  });

  it("sevenths follow the target key's diatonic quality", () => {
    const out = transposePlanToMode(
      plan({ key: "A minor", chords: [[0, "Am7"], [8, "Dm7"], [16, "E7"]] }),
      "major",
    );
    // i7 -> Imaj7, iv7 -> IVmaj7, V7 はそのまま V7
    expect(out.chords.map(([, s]) => s)).toEqual(["Amaj7", "Dmaj7", "E7"]);
  });

  it("keeps borrowed colours on the same degree", () => {
    // C 長調の bVI (Ab) と bVII (Bb) は短調化しても同じ度数・品質で残す
    const out = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C"], [8, "Ab"], [16, "Bb"], [24, "G"]] }),
      "minor",
    );
    expect(out.key).toBe("C minor");
    const symbols = out.chords.map(([, s]) => s);
    expect(symbols.slice(1, 3)).toEqual(["Ab", "Bb"]);
    for (const [, s] of out.chords) expect(() => parseChord(s)).not.toThrow();
  });

  it("flips the mode of key changes too", () => {
    const out = transposePlanToMode(
      plan({ keyChanges: [{ bar: 4, key: "C minor" }] }),
      "major",
    );
    expect(out.key).toBe("A major");
    expect(out.keyChanges).toEqual([{ bar: 4, key: "C major" }]);
  });

  it("keeps an inversion only when it is a chord tone of the new chord", () => {
    // C/E → Cm。短3度 E は Cm の構成音ではないので分数表記は落とす
    const out = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C/E"], [8, "G"]] }),
      "minor",
    );
    expect(out.chords[0]![1]).toBe("Cm");
    // C/G → Cm/G。5度 G は Cm の構成音なので転回形を維持できる
    const out2 = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C/G"], [8, "G"]] }),
      "minor",
    );
    expect(out2.chords[0]![1]).toBe("Cm/G");
  });

  it("realizes chords in key-change regions from the original local key", () => {
    const out = transposePlanToMode(
      plan({ key: "A minor", chords: [[0, "Am"], [16, "Ab"]], keyChanges: [{ bar: 4, key: "C minor" }] }),
      "major",
    );
    expect(out.key).toBe("A major");
    expect(out.keyChanges).toEqual([{ bar: 4, key: "C major" }]);
    // Ab は C minor の VI(長三和音) → C major の vi (Am)
    expect(out.chords.map(([, s]) => s)).toEqual(["A", "Am"]);
  });

  it("keeps the dim-family quality of leading-tone chords", () => {
    // viiø7 (Bm7b5) は短調でも調内なので、dom7 に化けさせない
    const out = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C"], [8, "Bm7b5"], [16, "G7"], [24, "C"]] }),
      "minor",
    );
    expect(out.key).toBe("C minor");
    expect(out.chords[1]![1]).toBe("Bm7b5");
    for (const [, s] of out.chords) expect(() => parseChord(s)).not.toThrow();
  });

  it("does not keep dim-family / mM7 qualities where the target key has no such chord", () => {
    // 短調の ii° (Ddim / Dm7b5) や i mM7 は、長調化すると通常の三和音/7th になる
    const out = transposePlanToMode(
      plan({ key: "C minor", chords: [[0, "CmM7"], [8, "Ddim"], [16, "Dm7b5"], [24, "G7"], [28, "CmM7"]] }),
      "major",
    );
    expect(out.key).toBe("C major");
    expect(out.chords.map(([, s]) => s)).toEqual(["Cmaj7", "Dm", "Dm7", "G7", "Cmaj7"]);
    // 長調 vii° の AmM7 → 短調では VI の maj7 へ
    const out2 = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C"], [8, "AmM7"], [16, "G7"], [24, "C"]] }),
      "minor",
    );
    expect(out2.chords[1]![1]).toBe("Abmaj7");
    for (const [, s] of [...out.chords, ...out2.chords]) expect(() => parseChord(s)).not.toThrow();
  });

  it("moves sixth chords' third to the target mode and keeps the sixth", () => {
    const out = transposePlanToMode(
      plan({ key: "C major", chords: [[0, "C6"], [8, "Am6"], [16, "G"], [24, "C6"]] }),
      "minor",
    );
    expect(out.key).toBe("C minor");
    expect(out.chords.map(([, s]) => s)).toEqual(["Cm6", "Ab6", "G", "Cm6"]);
  });

  it("keeps the result analysable as the target key", () => {
    const out = transposePlanToMode(plan(), "major");
    const key = parseKeyName(out.key);
    for (const [, symbol] of out.chords) {
      const a = analyzeChord(symbol, key);
      // 借用以外は調内に収まる
      if (a.borrowedFrom === undefined && a.appliedTo === undefined) expect(a.isDiatonic).toBe(true);
    }
  });
});

describe("planModeConflict", () => {
  it("flags a major-key plan whose chords are centred on the parallel minor", () => {
    const bad = plan({ key: "F major", chords: [[0, "Fm"], [8, "Db"], [16, "Ab"], [24, "Eb"]] });
    expect(planModeConflict(bad, "major")).toContain("parallel minor");
    // 正しい長調の進行は警告しない
    const good = plan({ key: "F major", chords: [[0, "F"], [8, "Bb"], [16, "C"], [24, "F"]] });
    expect(planModeConflict(good, "major")).toBeNull();
    // vi-IV-I-V は相対短調寄りだが長調のダイアトニック進行なので警告しない
    const relative = plan({ key: "C major", chords: [[0, "Am"], [8, "F"], [16, "C"], [24, "G"]] });
    expect(planModeConflict(relative, "major")).toBeNull();
    // I–bVI–bVII–I のようなモーダルな借用は「主音が長調のまま」なので警告しない
    const modal = plan({ key: "C major", chords: [[0, "C"], [8, "Ab"], [16, "Bb"], [24, "C"]] });
    expect(planModeConflict(modal, "major")).toBeNull();
    const modalLoop = plan({ key: "C major", chords: [[0, "C"], [8, "Ab"], [16, "Bb"], [24, "C"], [32, "F"], [40, "Ab"], [48, "Bb"], [56, "C"]] });
    expect(planModeConflict(modalLoop, "major")).toBeNull();
  });

  it("flags a minor-key plan whose chords are centred on the parallel major", () => {
    const bad = plan({ key: "A minor", chords: [[0, "A"], [8, "F#m"], [16, "D"], [24, "E"]] });
    expect(planModeConflict(bad, "minor")).toContain("parallel major");
    const good = plan({ key: "A minor", chords: [[0, "Am"], [8, "F"], [16, "G"], [24, "E7"]] });
    expect(planModeConflict(good, "minor")).toBeNull();
  });

  it("ignores mode-neutral chords (sus/power) when judging the mode", () => {
    // 3度を持たない和音はモード中立。Csus4/C5 を並行長調の借用と誤判定しない
    const sus = plan({ key: "C minor", chords: [[0, "Csus4"], [8, "G"], [16, "Csus4"], [24, "G"]] });
    expect(planModeConflict(sus, "minor")).toBeNull();
    const power = plan({ key: "C minor", chords: [[0, "C5"], [8, "G"], [16, "C5"], [24, "G"]] });
    expect(planModeConflict(power, "minor")).toBeNull();
    // 3度を持つ並行長調のトニックは従来どおり検出する
    const real = plan({ key: "C minor", chords: [[0, "C"], [8, "G"], [16, "C"], [24, "G"]] });
    expect(planModeConflict(real, "minor")).toContain("parallel major");
  });

  it("ignores modulation regions whose local mode differs from the target", () => {
    const p = plan({
      key: "C major",
      chords: [[0, "C"], [8, "G"], [16, "Am"], [24, "F"]],
      keyChanges: [{ bar: 4, key: "A minor" }],
    });
    // メインの C major 区間は正常なので警告しない
    expect(planModeConflict(p, "major")).toBeNull();
  });
});
