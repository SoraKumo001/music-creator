import { describe, expect, it } from "vitest";
import { assemble } from "../src/compose";
import { applyCorpusHints, isCalmPrompt, isDrivingPrompt } from "../src/knowledge/corpus";
import { pickGenreCards } from "../src/knowledge/genres";
import { PlanSchema, resolveSections } from "../src/plan";
import type { Note } from "../src/score";
import { generateComp, type Arrangement } from "../src/theory/accompaniment";
import { colorPlan } from "../src/theory/color";
import { generateDrums } from "../src/theory/drums";
import { developTheme } from "../src/theory/melody";
import { GM_DRUMS } from "../src/theory/index";
import {
  generateArp,
  generateHarmony,
  generatePad,
  generateSeq16,
} from "../src/theory/texture";
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
  const plan = mk(
    [
      [0, "C"],
      [8, "Am"],
      [16, "F"],
      [24, "G"],
    ],
    {
      sections: [
        { name: "A", bars: 4, comp: "block", energy: 2 },
        { name: "B", bars: 4, comp: "strum", energy: 3 },
      ],
    },
  );
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
      mk(
        [
          [0, "C"],
          [8, "G"],
        ],
        { sections: [{ name: "I", bars: 4, energy: 1 }] },
      ),
      4,
      4,
    );
    expect(
      generatePad(events, { sections: intro, totalBeats: 16, beatsPerBar: 4 }),
    ).toHaveLength(0);
  });

  it("arp uses 16ths in high energy and stays inside the song", () => {
    const arp = generateArp(events, arr);
    expect(arp.length).toBeGreaterThan(8);
    expect(
      Math.max(...arp.map((n) => n.start + n.duration)),
    ).toBeLessThanOrEqual(32.001);
    // energy 3 のセクションは16分 (0.25 刻み) が出る
    const b = arp.filter((n) => n.start >= 16);
    expect(
      b.some(
        (n) =>
          Math.abs((n.start % 1) - 0.25) < 1e-6 ||
          Math.abs((n.start % 1) - 0.75) < 1e-6,
      ),
    ).toBe(true);
  });

  it("harmony adds a diatonic third below long notes", () => {
    const h = generateHarmony(melody, plan, 4);
    expect(h.length).toBeGreaterThan(0);
    for (const n of h) expect(n.pitch).toBeLessThan(72 + 1);
    // 短い音には付けない
    const short = generateHarmony(
      [{ pitch: 72, start: 0, duration: 0.25, velocity: 90 }],
      plan,
      4,
    );
    expect(short).toHaveLength(0);
  });

  it("assemble can add texture voices on distinct channels", () => {
    const score = assemble(plan, sections, melody, 8, {
      texture: true,
      arp: true,
    });
    const names = score.tracks.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Harmony",
        "Pad",
        "Arp",
        "Seq16",
        "Chords",
        "Bass",
        "Drums",
      ]),
    );
    const channels = score.tracks.map((t) => t.channel);
    expect(new Set(channels).size).toBe(channels.length);
    // 既定では従来通り
    const plain = assemble(plan, sections, melody, 8);
    expect(plain.tracks.map((t) => t.name)).toEqual([
      plan.melodyName,
      "Chords",
      "Bass",
      "Drums",
    ]);
  });

  it("seq16 plays 16th-note chord tones in energy >= 2 sections", () => {
    const seq = generateSeq16(events, arr);
    expect(seq.length).toBeGreaterThan(16);
    // 16分の位置 (0.25刻み) が大半
    const offBeatQuarters = seq.filter(
      (n) => Math.abs(n.start % 0.25) < 1e-6,
    ).length;
    expect(offBeatQuarters).toBe(seq.length);
    // 音域は 60 前後から
    for (const n of seq) expect(n.pitch).toBeGreaterThanOrEqual(55);
  });
});

describe("colorPlan", () => {
  it("adds borrowed or secondary chords without breaking validation", () => {
    const plan = mk([
      [0, "C"],
      [8, "Am"],
      [16, "F"],
      [24, "G"],
      [28, "E7"],
      [32, "Am"],
      [36, "Dm"],
      [40, "Am"],
    ]);
    const before = validatePlan(plan, 12).filter(
      (i) => i.severity === "error",
    ).length;
    const {
      plan: colored,
      changes,
      reverted,
    } = colorPlan(plan, 12, 7, { strength: 1, maxChanges: 3 });
    expect(reverted).toBe(false);
    expect(changes).toBeGreaterThan(0);
    const after = validatePlan(colored, 12).filter(
      (i) => i.severity === "error",
    ).length;
    expect(after).toBeLessThanOrEqual(before);
    // 元プランは破壊しない
    expect(plan.chords).toHaveLength(8);
  });

  it("is deterministic for the same seed and inert at strength 0", () => {
    const plan = mk([
      [0, "C"],
      [8, "Am"],
      [16, "F"],
      [24, "G"],
      [28, "E7"],
      [32, "Am"],
    ]);
    const a = colorPlan(plan, 8, 42, { strength: 1, maxChanges: 2 });
    const b = colorPlan(plan, 8, 42, { strength: 1, maxChanges: 2 });
    expect(a.plan.chords).toEqual(b.plan.chords);
    const none = colorPlan(plan, 8, 42, { strength: 0 });
    expect(none.changes).toBe(0);
    expect(none.plan.chords).toEqual(plan.chords);
  });

  it("keeps the first and last two bars untouched", () => {
    const plan = mk([
      [0, "C"],
      [8, "Am"],
      [16, "F"],
      [24, "G"],
      [32, "Am"],
    ]);
    const { plan: colored } = colorPlan(plan, 10, 3, {
      strength: 1,
      maxChanges: 10,
    });
    const beatsPerBar = 4;
    const total = 10 * beatsPerBar;
    for (const [beat, symbol] of colored.chords) {
      const original = plan.chords.find(([b]) => b === beat)![1];
      if (beat < 2 * beatsPerBar || beat >= total - 2 * beatsPerBar)
        expect(symbol).toBe(original);
    }
  });
});

describe("texture does not affect harmony generation", () => {
  it("chords track is unchanged by texture options", () => {
    const plan = mk([
      [0, "C"],
      [8, "G"],
    ]);
    const sections = resolveSections(plan, 4, 4);
    const events = plan.chords.map(([start, symbol]) => ({ start, symbol }));
    const arr: Arrangement = { sections, totalBeats: 16, beatsPerBar: 4 };
    const plain = assemble(plan, sections, melody, 4);
    const textured = assemble(plan, sections, melody, 4, { texture: true });
    const chordsOf = (s: typeof plain) =>
      s.tracks.find((t) => t.name === "Chords")!.notes;
    expect(chordsOf(textured)).toEqual(chordsOf(plain));
    void generateComp(events, arr);
  });

  it("ducks arp and seq16 below active melody and uses distinct timbres", () => {
    const leadPlan = mk(
      [
        [0, "Am"],
        [16, "F"],
        [32, "G"],
        [48, "Am"],
      ],
      {
        melodyProgram: 81,
        compProgram: 29,
        sections: [
          { name: "Intro", bars: 4, role: "intro", energy: 2 },
          { name: "Chorus", bars: 4, role: "chorus", energy: 3 },
        ],
      },
    );
    const secs = resolveSections(leadPlan, 8, 4);
    // Intro (beats 0..16) はメロディなし、Chorus (beats 16..32) は MIDI 72..76 のメロディあり
    const chorusMelody: Note[] = [
      { pitch: 72, start: 16, duration: 2, velocity: 100 },
      { pitch: 74, start: 18, duration: 2, velocity: 100 },
      { pitch: 76, start: 20, duration: 4, velocity: 105 },
      { pitch: 72, start: 24, duration: 4, velocity: 100 },
    ];
    const score = assemble(leadPlan, secs, chorusMelody, 8, {
      seed: 7,
      texture: true,
      arp: true,
      arpSixteenth: true,
      counter: [{ pitch: 67, start: 16, duration: 2, velocity: 70 }],
    });
    const melTrack = score.tracks.find((t) => t.name === leadPlan.melodyName)!;
    const arpTrack = score.tracks.find((t) => t.name === "Arp")!;
    const seqTrack = score.tracks.find((t) => t.name === "Seq16")!;
    const cntTrack = score.tracks.find((t) => t.name === "Counter")!;

    // 補助パートが主旋律と同じ音色 (81) にならない
    expect(arpTrack.program).not.toBe(melTrack.program);
    expect(seqTrack.program).not.toBe(melTrack.program);
    expect(cntTrack.program).not.toBe(melTrack.program);

    // メロディが鳴っている区間 (16..28) では Arp と Seq16 がメロディ最低音 (72) より下に収まる
    const arpInChorus = arpTrack.notes.filter(
      (n) => n.start >= 16 && n.start < 28,
    );
    const seqInChorus = seqTrack.notes.filter(
      (n) => n.start >= 16 && n.start < 28,
    );
    expect(Math.max(...arpInChorus.map((n) => n.pitch))).toBeLessThan(72);
    expect(Math.max(...seqInChorus.map((n) => n.pitch))).toBeLessThan(72);
  });

  it("colorPlan preserves 4-bar periodic repetition across an 8-bar section", () => {
    // 4小節周期の反復進行 (bar 0..3 と bar 4..7 が同一: C - Am - F - G)
    const periodic = mk([
      [0, "C"],
      [4, "Am"],
      [8, "F"],
      [12, "G"],
      [16, "C"],
      [20, "Am"],
      [24, "F"],
      [28, "G"],
      [32, "C"],
      [36, "G"],
      [40, "C"],
    ]);
    const { plan: colored, changes } = colorPlan(periodic, 11, 5, {
      strength: 1,
      maxChanges: 6,
    });
    expect(changes).toBeGreaterThan(0);
    // 1周目の bar 2 (beat 8: F->G) と 2周目の bar 6 (beat 24: F->G) が同じ和音に揃う
    const bar2 = colored.chords.find(([b]) => b === 8)![1];
    const bar6 = colored.chords.find(([b]) => b === 24)![1];
    expect(bar6).toBe(bar2);
  });

  it("developTheme reprises motifs across returning sections and lifts chorus register", () => {
    const songPlan = mk(
      [
        [0, "Am"],
        [8, "F"],
        [16, "G"],
        [24, "Am"],
        [32, "F"],
        [40, "G"],
        [48, "Em"],
        [56, "Am"],
      ],
      {
        bpm: 130,
        key: "A minor",
        sections: [
          { name: "Verse 1", bars: 4, role: "verse", energy: 2 },
          { name: "Chorus 1", bars: 4, role: "chorus", energy: 3 },
          { name: "Verse 2", bars: 4, role: "verse", energy: 2 },
          { name: "Chorus 2", bars: 4, role: "chorus", energy: 3 },
        ],
      },
    );
    const secs = resolveSections(songPlan, 16, 4);
    // Verse 1 の先頭2小節だけ明確なモチーフがあり、後半や Verse 2 が希薄な入力
    const raw: Note[] = [
      { pitch: 69, start: 0, duration: 0.5, velocity: 90 },
      { pitch: 71, start: 0.5, duration: 0.5, velocity: 88 },
      { pitch: 72, start: 1, duration: 1, velocity: 95 },
      { pitch: 76, start: 2, duration: 1, velocity: 98 },
      { pitch: 74, start: 3, duration: 0.5, velocity: 90 },
      // Verse 1 後半は1音だけ
      { pitch: 69, start: 8, duration: 2, velocity: 85 },
      // Chorus 1 (低すぎる音域で入力されても高音域へリフトされるか)
      { pitch: 60, start: 16, duration: 0.5, velocity: 90 },
      { pitch: 62, start: 16.5, duration: 0.5, velocity: 90 },
      { pitch: 64, start: 17, duration: 1, velocity: 95 },
      { pitch: 67, start: 18, duration: 1.5, velocity: 95 },
      // Verse 2 (beats 32..48) は別バラバラな1音だけ
      { pitch: 64, start: 32, duration: 2, velocity: 80 },
      // Chorus 2 (beats 48..64)
      { pitch: 60, start: 48, duration: 2, velocity: 80 },
    ];
    const developed = developTheme(raw, songPlan, secs, 4, { dense: true });
    const v1Head = developed.filter((n) => n.start >= 0 && n.start < 8);
    const v1Ans = developed.filter((n) => n.start >= 8 && n.start < 16);
    const v2Head = developed.filter((n) => n.start >= 32 && n.start < 40);
    const c1Notes = developed.filter((n) => n.start >= 16 && n.start < 32);

    // Verse 1 後半 (A') と Verse 2 先頭が Verse 1 先頭モチーフを継承して十分な音数を持つ
    expect(v1Ans.length).toBeGreaterThanOrEqual(4);
    expect(v2Head.length).toBeGreaterThanOrEqual(v1Head.length);
    // Chorus は高音域 (MIDI 68以上) に配置される
    expect(Math.min(...c1Notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(68);
  });

  it("isCalmPrompt avoids forcing 16th-note arpeggio/bass on calm genres", () => {
    expect(isCalmPrompt("静かなローファイ")).toBe(true);
    expect(isCalmPrompt("しっとりしたピアノバラード")).toBe(true);
    expect(isCalmPrompt("疾走感のあるゲームステージBGM")).toBe(false);
    const p = mk([[0, "C"]], {
      sections: [
        { name: "A", bars: 4, comp: "block", bass: "rootFifth", energy: 2 },
      ],
    });
    const calm = applyCorpusHints(p, {
      prompt: "静かなローファイ",
      dense: true,
    });
    expect(calm.sections[0]!.comp).toBe("block");
    expect(calm.sections[0]!.bass).toBe("rootFifth");
  });

  it("evolves drum grooves across 4-bar phrases, section roles, and prechorus build-ups", () => {
    const drumPlan = mk([[0, "Am"], [32, "F"], [48, "G"], [80, "Am"]], {
      sections: [
        { name: "Verse", bars: 8, role: "verse", drums: "rock", energy: 2 },
        { name: "Pre", bars: 4, role: "prechorus", drums: "rock", energy: 2, swell: 1 },
        { name: "Chorus", bars: 8, role: "chorus", drums: "rock", energy: 3 },
      ],
    });
    const secs = resolveSections(drumPlan, 20, 4);
    const notes = generateDrums(secs, 4, "button", false, { seed: 42 });

    // 1. 同一セクション内で1小節目(beats 0..4)と2小節目(beats 4..8)と4小節目(beats 12..16)が単調な完全一致にならない
    const barPattern = (b: number) =>
      notes
        .filter((n) => n.start >= b * 4 && n.start < (b + 1) * 4 && n.pitch !== GM_DRUMS.crash)
        .map((n) => `${n.start - b * 4}:${n.pitch}`)
        .join(",");
    expect(barPattern(1)).not.toBe(barPattern(0));
    expect(barPattern(3)).not.toBe(barPattern(0)); // 4小節目の中間ターンアラウンドフィル

    // 2. サビ (bars 12..19) は同じ "rock" 指定でもライドシンバルやオープンハットが加わり、5小節目(bar 16)にもクラッシュが入る
    const verseNotes = notes.filter((n) => n.start >= 0 && n.start < 32);
    const chorusNotes = notes.filter((n) => n.start >= 48 && n.start < 76);
    expect(chorusNotes.some((n) => n.pitch === GM_DRUMS.ride)).toBe(true);
    expect(verseNotes.some((n) => n.pitch === GM_DRUMS.ride)).toBe(false);
    expect(chorusNotes.some((n) => n.pitch === GM_DRUMS.crash && Math.abs(n.start - 64) < 1e-6)).toBe(true);

    // 3. Prechorus 最終小節 (bar 11 = beats 44..48) はスネア+タム/キックのビルドアップクレッシェンドになる
    const buildUp = notes.filter((n) => n.start >= 44 && n.start < 48 && n.pitch === GM_DRUMS.snare);
    expect(buildUp.length).toBeGreaterThanOrEqual(6);

    // 4. applyCorpusHints は全セクション同一ドラム指定のときに Chorus / Bridge を自動で変化させる
    const varied = applyCorpusHints(
      mk([[0, "Am"]], {
        sections: [
          { name: "V", bars: 4, role: "verse", drums: "rock", energy: 2 },
          { name: "B", bars: 4, role: "bridge", drums: "rock", energy: 2 },
          { name: "C", bars: 4, role: "chorus", drums: "rock", energy: 3 },
        ],
      }),
      { prompt: "疾走感のあるロック", dense: true },
    );
    expect(new Set(varied.sections.map((s) => s.drums)).size).toBeGreaterThanOrEqual(2);
  });

  it("boosts tempo, guitar chug, bass drive, and fast drums for '疾走感のあるロック'", () => {
    expect(isDrivingPrompt("疾走感のあるロック")).toBe(true);
    const cards = pickGenreCards("疾走感のあるロック").map((c) => c.id);
    expect(cards).toContain("rock");
    expect(cards).toContain("speed");

    // LLM が 125 BPM・strum/root/rock という中速ロックの設計を出した場合でも、疾走仕様へ引き上げる
    const slowRock = mk([[0, "Em"], [16, "C"], [32, "D"], [48, "Em"]], {
      bpm: 125,
      key: "E minor",
      sections: [
        { name: "Verse", bars: 4, role: "verse", comp: "strum", bass: "root", drums: "rock", energy: 2 },
        { name: "Chorus", bars: 4, role: "chorus", comp: "block", bass: "rootFifth", drums: "rock", energy: 3 },
      ],
    });
    const boosted = applyCorpusHints(slowRock, { prompt: "疾走感のあるロック", dense: true });
    expect(boosted.bpm).toBeGreaterThanOrEqual(160);
    expect(boosted.sections[0]!.comp).toBe("chug");
    expect(boosted.sections[0]!.bass).toBe("eighths");
    expect(boosted.sections[0]!.drums).toBe("drive");
    expect(boosted.sections[1]!.drums).toBe("game16th");

    // chug スタイルが1小節あたり8回以上の細かい刻みを生成することを確認
    const secs = resolveSections(boosted, 8, 4);
    const events = boosted.chords.map(([start, symbol]) => ({ start, symbol }));
    const compNotes = generateComp(events, { sections: secs, totalBeats: 32, beatsPerBar: 4 }, { seed: 1 });
    const bar1Starts = new Set(compNotes.filter((n) => n.start >= 0 && n.start < 4).map((n) => n.start));
    expect(bar1Starts.size).toBeGreaterThanOrEqual(9); // 8分8打 + 16分ギャロップ
  });
});
