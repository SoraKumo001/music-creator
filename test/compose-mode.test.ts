import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * compose() のモード強制の統合テスト (LLM はモック)。
 * プラン応答のモードが指定と違う場合に作り直されること、
 * 既定回数内で直らなければ同主調へ実現し直すフォールバックが働くことを確認する。
 */

const state = vi.hoisted(() => ({
  responses: [] as string[],
  messages: [] as { role: string; content: string }[][],
}));
vi.mock("../src/llm/provider", () => ({
  chat: vi.fn(async (_cfg: unknown, messages: { role: string; content: string }[]) => {
    state.messages.push(messages);
    const content = state.responses.shift();
    if (content === undefined) throw new Error("mock: no more responses");
    return { content, usage: { completion_tokens: 1 }, ms: 1 };
  }),
}));

import { compose } from "../src/compose";
import type { LlmConfig } from "../src/llm/provider";
import { parseKeyName } from "../src/theory/key";
import { pickMode } from "../src/prompt";
import { planModeConflict } from "../src/theory/mode";

const cfg: LlmConfig = { baseUrl: "http://mock", model: "mock", apiKey: "x" };
const PROMPT = "ゲームのボス戦BGM";

function planJson(key: string, chords: [number, string][]): string {
  return JSON.stringify({
    title: "Mock",
    bpm: 150,
    timeSignature: [4, 4],
    key,
    chords,
    sections: [
      { name: "A", bars: 4, role: "verse", energy: 2 },
      { name: "B", bars: 4, role: "chorus", energy: 3 },
    ],
  });
}

function melodyJson(): string {
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    notes.push([72 + (bar % 5), bar * 4, 1, 100]);
    notes.push([74 + (bar % 5), bar * 4 + 1, 1, 92]);
  }
  return JSON.stringify({ notes });
}

/** 長調 (または短調) のダイアトニックな 8 小節プラン */
function goodPlanJson(mode: "major" | "minor"): string {
  return mode === "major"
    ? planJson("D major", [[0, "D"], [4, "G"], [8, "A7"], [12, "D"], [16, "Bm"], [20, "G"], [24, "A7"], [28, "D"]])
    : planJson("D minor", [[0, "Dm"], [4, "Bb"], [8, "Gm"], [12, "A7"], [16, "Dm"], [20, "Bb"], [24, "C"], [28, "Dm"]]);
}

/** キーは指定モードだが和音が並行短調/長調に寄っている (響きが逆) プラン */
function conflictedPlanJson(mode: "major" | "minor"): string {
  return mode === "major"
    ? planJson("D major", [[0, "Dm"], [4, "Bb"], [8, "Gm"], [12, "A7"], [16, "Dm"], [20, "Bb"], [24, "C"], [28, "Dm"]])
    : planJson("D minor", [[0, "D"], [4, "G"], [8, "A7"], [12, "D"], [16, "Bm"], [20, "G"], [24, "A7"], [28, "D"]]);
}

function seedFor(mode: "major" | "minor"): number {
  for (let seed = 1; seed <= 200; seed++) if (pickMode(PROMPT, seed) === mode) return seed;
  throw new Error(`no seed found for ${mode}`);
}

/** クラフト違反が2項目以上あるプラン (遅いトニック + セクションの表情が同一) */
function craftViolatingPlanJson(): string {
  return JSON.stringify({
    title: "Mock",
    bpm: 150,
    timeSignature: [4, 4],
    key: "D major",
    chords: [[0, "Bm"], [4, "G"], [8, "A"], [12, "D"], [16, "Bm"], [20, "G"], [24, "A"], [28, "D"]],
    sections: [
      { name: "A", bars: 4, role: "verse", energy: 2, comp: "pad", bass: "root", drums: "basic" },
      { name: "B", bars: 4, role: "verse", energy: 2, comp: "pad", bass: "root", drums: "basic" },
    ],
  });
}

beforeEach(() => {
  state.responses.length = 0;
  state.messages.length = 0;
});

describe("compose mode enforcement", () => {
  it("regenerates the plan when the LLM uses the wrong mode", async () => {
    const target = pickMode(PROMPT, seedFor("major"));
    const seed = seedFor("major");
    const wrongMode = target === "major" ? "minor" : "major";
    state.responses.push(goodPlanJson(wrongMode), goodPlanJson(target), melodyJson(), melodyJson(), melodyJson());
    const r = await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    expect(r.attempts).toBe(2);
    expect(parseKeyName(r.plan.key).mode).toBe(target);
    expect(planModeConflict(r.plan, target)).toBeNull();
  });

  it("falls back to the parallel mode when the LLM never complies", async () => {
    const seed = seedFor("major");
    const wrongMode = "minor" as const;
    state.responses.push(
      goodPlanJson(wrongMode),
      goodPlanJson(wrongMode),
      goodPlanJson(wrongMode),
      melodyJson(),
      melodyJson(),
      melodyJson(),
    );
    const r = await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    expect(r.attempts).toBe(3);
    // 同じ主音 (D) のまま長調へ実現し直す
    expect(r.plan.key).toBe("D major");
    expect(parseKeyName(r.plan.key).mode).toBe("major");
    expect(planModeConflict(r.plan, "major")).toBeNull();
  });

  it("regenerates when the key mode is right but the chords sound like the other mode", async () => {
    const seed = seedFor("major");
    state.responses.push(conflictedPlanJson("major"), goodPlanJson("major"), melodyJson(), melodyJson(), melodyJson());
    const r = await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    expect(r.attempts).toBe(2);
    expect(parseKeyName(r.plan.key).mode).toBe("major");
    expect(planModeConflict(r.plan, "major")).toBeNull();
  });

  it("keeps a harmony-valid plan when later attempts are broken", async () => {
    const seed = seedFor("major");
    // 1回目: 和声は有効だがモード内容が寄っている / 2・3回目: 壊れた JSON
    state.responses.push(
      conflictedPlanJson("major"),
      "not json",
      "not json",
      melodyJson(),
      melodyJson(),
      melodyJson(),
    );
    const r = await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    // 全却下で失敗させず、和声として成立する 1 回目の案を採用する
    expect(r.plan.key).toBe("D major");
    expect(parseKeyName(r.plan.key).mode).toBe("major");
  });

  it("regenerates when two or more craft rules are broken", async () => {
    const seed = seedFor("major");
    state.responses.push(craftViolatingPlanJson(), goodPlanJson("major"), melodyJson(), melodyJson(), melodyJson());
    const r = await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    expect(r.attempts).toBe(2);
    // 採用されたプランはクラフト違反が1項目以下
    expect(r.craft.failed.length).toBeLessThanOrEqual(1);
    expect(r.craft.score).toBeGreaterThanOrEqual(80);
  });

  it("does not inject web knowledge by default (opt-in after the A/B showed a regression)", async () => {
    const seed = seedFor("major");
    state.responses.push(goodPlanJson("major"), melodyJson(), melodyJson(), melodyJson());
    await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard" });
    const system = state.messages[0]![0]!.content;
    expect(system).not.toContain("Composition craft notes");
  });

  it("injects web knowledge when explicitly enabled", async () => {
    const seed = seedFor("major");
    state.responses.push(goodPlanJson("major"), melodyJson(), melodyJson(), melodyJson());
    await compose(cfg, PROMPT, 8, { seed, creativity: 0.5, complexity: "standard", webKnowledge: true });
    const system = state.messages[0]![0]!.content;
    expect(system).toContain("Composition craft notes");
  });
});
