import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UI (public/index.html) の回帰テスト。
 * ブラウザ実行はしないが、過去に踏んだ罠を静的に検出する。
 */
const html = readFileSync("public/index.html", "utf8");

describe("playback defaults", () => {
  it("does not turn the volume to 0 when nothing is saved", () => {
    // localStorage.getItem() は未設定で null を返し、Number(null) は 0。
    // 生の値で存在確認していないと、初回起動が無音になる。
    expect(html).toMatch(/const raw = localStorage\.getItem\("mc-volume"\)/);
    expect(html).toMatch(/raw !== null/);
    // 既定音量が 0 でない
    expect(html).toMatch(/let volumePct = (\d+);/);
    const m = /let volumePct = (\d+);/.exec(html)!;
    expect(Number(m[1])).toBeGreaterThan(0);
  });

  it("keeps the audition loop flag null-safe", () => {
    expect(html).toContain('localStorage.getItem("mc-audition-loop") === "1"');
  });

  it("has a positive master gain curve", () => {
    const m = /const gainFor = \(pct\) => ([\d.]+) \* Math\.pow/.exec(html);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it("keeps the web knowledge toggle off by default (opt-in) but sends/restores it", () => {
    // A/B実測でコーパス適合度が下がったため既定OFF。ユーザーが明示的にONにできる
    const input = /<input id="webKnowledge"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).not.toBe("");
    expect(input).not.toMatch(/\bchecked\b/);
    expect(html).toContain('webKnowledge: $("webKnowledge").checked');
    expect(html).toContain("full.request.webKnowledge");
  });
});
