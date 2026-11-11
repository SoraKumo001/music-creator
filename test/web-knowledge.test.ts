import { describe, expect, it } from "vitest";
import {
  applyWebHints,
  cardFitsContext,
  chunkText,
  hasWebKnowledge,
  mergeKnowledgeCards,
  normalizeKnowledgeCard,
  selectWebKnowledge,
  STYLE_TAGS,
  webKnowledgeCards,
  webKnowledgeGuidance,
  webStyleHints,
  type StyleTag,
  type WebKnowledgeCard,
} from "../src/knowledge/web-knowledge";
import { PlanSchema } from "../src/plan";
import { planMessages } from "../src/prompt";

const source = { url: "https://example.org/a", title: "Example source", license: "CC BY-SA 4.0" };

function card(overrides: Partial<WebKnowledgeCard> = {}): WebKnowledgeCard {
  return {
    id: "c1",
    category: "harmony",
    title: "Keep the tonic audible",
    advice: ["State the tonic early and at phrase ends."],
    keywords: ["和声", "tonic", "cadence"],
    confidence: 0.8,
    sourceUrl: source.url,
    sourceTitle: source.title,
    license: source.license,
    ...overrides,
  };
}

describe("selectWebKnowledge", () => {
  const cards = [
    card({ id: "a", category: "harmony", keywords: ["和声", "tonic"], title: "H" }),
    card({ id: "b", category: "rhythm", keywords: ["groove", "リズム"], title: "R" }),
    card({ id: "c", category: "melody", keywords: ["melody"], title: "M" }),
  ];

  it("matches Japanese keywords by substring", () => {
    expect(selectWebKnowledge("和声を勉強したい", cards).map((c) => c.id)).toEqual(["a"]);
  });

  it("matches English keywords by word boundary", () => {
    expect(selectWebKnowledge("improve the groove", cards).map((c) => c.id)).toEqual(["b"]);
    // "grooves" は \bgroove にマッチするが、"engroove" のような部分一致はしない
    expect(selectWebKnowledge("agroovex", cards)).toEqual([]);
  });

  it("ranks by keyword hits and respects the limit", () => {
    const picked = selectWebKnowledge("和声 tonic groove melody", cards, 2);
    expect(picked.length).toBe(2);
    expect(picked[0]!.id).toBe("a"); // 2ヒット
  });

  it("returns nothing for unrelated prompts when fallback is off", () => {
    expect(selectWebKnowledge("雨の日の静かな曲", cards)).toEqual([]);
  });

  it("falls back to core-category cards deterministically when fallback is on", () => {
    const a = selectWebKnowledge("雨の日の静かな曲", cards, 2, { fallback: true });
    const b = selectWebKnowledge("雨の日の静かな曲", cards, 2, { fallback: true });
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id)); // 同じプロンプトは同じ選択
    // 中核カテゴリ (harmony/rhythm) から選ばれる
    for (const c of a) expect(["harmony", "rhythm", "form", "arrangement"]).toContain(c.category);
  });
});

describe("webKnowledgeGuidance", () => {
  it("formats matched cards as reference data and always injects something for generated cards", () => {
    const text = webKnowledgeGuidance("和声について", [card()]);
    expect(text).toContain("Composition craft notes");
    expect(text).toContain("reference data");
    expect(text).toContain("[harmony]");
    expect(text).toContain("(source: Example source)");
    // 一致しないプロンプトでも中核カテゴリからフォールバックする
    expect(webKnowledgeGuidance("全く無関係な文章", [card()])).toContain("Composition craft notes");
    // カードが空、またはフォールバック対象も無ければ空文字
    expect(webKnowledgeGuidance("全く無関係な文章", [])).toBe("");
    const niche = card({ category: "production", confidence: 0.5, keywords: ["niche-only"] });
    expect(webKnowledgeGuidance("全く無関係な文章", [niche])).toBe("");
  });

  it("can be disabled with the web:false prompt option", () => {
    const off = planMessages("和声 melody groove", 8, false, "band", { web: false })[0]!.content;
    expect(off).not.toContain("Composition craft notes");
    // カードが生成済みでマッチする場合のみ、既定で注入されることも確認
    if (webKnowledgeGuidance("和声 melody groove") !== "") {
      const on = planMessages("和声 melody groove", 8, false, "band")[0]!.content;
      expect(on).toContain("Composition craft notes");
    }
  });

  it("exposes whether generated cards exist", () => {
    expect(typeof hasWebKnowledge()).toBe("boolean");
  });
});

describe("chunkText", () => {
  const para = "a".repeat(800);
  const long = Array.from({ length: 12 }, () => para).join("\n\n");

  it("splits long text into at most maxChunks chunks", () => {
    const chunks = chunkText(long, 2000, 3);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000 * 1.4);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkText("short text")).toEqual(["short text"]);
  });

  it("returns empty for empty input", () => {
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});

describe("normalizeKnowledgeCard", () => {
  it("validates and normalizes a card", () => {
    const out = normalizeKnowledgeCard(
      {
        category: "HARMONY",
        title: "Keep the tonic audible",
        advice: ["State the tonic early.", "End phrases on chord tones."],
        keywords: ["和声", "tonic", "tonic"],
        confidence: 2,
      },
      source,
      3,
    );
    expect(out).not.toBeNull();
    expect(out!.category).toBe("harmony");
    expect(out!.confidence).toBe(1);
    expect(out!.keywords).toEqual(["和声", "tonic"]); // 重複除去
    expect(out!.sourceUrl).toBe(source.url);
  });

  it("accepts advice/keywords given as plain strings (LLM output variance)", () => {
    const out = normalizeKnowledgeCard(
      { title: "Valid title", advice: "Do one thing. Do another thing.", keywords: "tonic" },
      source,
      0,
    );
    expect(out).not.toBeNull();
    expect(out!.keywords).toEqual(["tonic"]);
    // 長すぎる1文は上限内へ切り詰める
    const long = normalizeKnowledgeCard(
      { title: "Valid title", advice: "a".repeat(400), keywords: ["tonic"] },
      source,
      0,
    );
    expect(long!.advice[0]!.length).toBeLessThanOrEqual(320);
  });

  it("rejects empty/invalid cards and falls back to the theory category", () => {
    expect(normalizeKnowledgeCard({ title: "x", advice: ["a"], keywords: ["k"] }, source, 0)).toBeNull();
    expect(normalizeKnowledgeCard({ title: "Valid title", advice: [], keywords: ["k"] }, source, 0)).toBeNull();
    expect(normalizeKnowledgeCard({ title: "Valid title", advice: ["a"], keywords: [] }, source, 0)).toBeNull();
    const unknown = normalizeKnowledgeCard(
      { category: "unknown-category", title: "Valid title", advice: ["Do X."], keywords: ["x"] },
      source,
      0,
    );
    expect(unknown!.category).toBe("theory");
  });
});

describe("webStyleHints / applyWebHints", () => {
  const styleCards = [
    card({ id: "drive", keywords: ["疾走"], styleTags: ["powerChords", "dense"] as StyleTag[] }),
    card({ id: "calm", keywords: ["静か"], styleTags: ["sparse", "swing"] as StyleTag[] }),
  ];
  const basePlan = () =>
    PlanSchema.parse({ bpm: 120, key: "C major", chords: [[0, "C"]], sections: [{ name: "A", bars: 8 }] });

  it("aggregates tags from matched cards into style hints", () => {
    const hints = webStyleHints("疾走する曲", styleCards);
    expect(hints.tags).toEqual(["powerChords", "dense"]);
    expect(hints.comp).toBe("chug");
    expect(hints.bass).toBe("sixteenths");
  });

  it("applies hints only to schema defaults and respects explicit styles", () => {
    const out = applyWebHints(basePlan(), { prompt: "疾走する曲", dense: true, cards: styleCards });
    expect(out.sections[0]!.comp).toBe("chug");
    expect(out.sections[0]!.bass).toBe("sixteenths");

    const explicit = PlanSchema.parse({
      bpm: 120,
      key: "C major",
      chords: [[0, "C"]],
      sections: [{ name: "A", bars: 8, comp: "block", bass: "walking", drums: "rock" }],
    });
    const kept = applyWebHints(explicit, { prompt: "疾走する曲", dense: true, cards: styleCards });
    expect(kept.sections[0]!.comp).toBe("block");
    expect(kept.sections[0]!.bass).toBe("walking");
    expect(kept.sections[0]!.drums).toBe("rock");
  });

  it("ignores dense tags when dense is false", () => {
    const denseOnly = [card({ keywords: ["疾走"], styleTags: ["dense"] as StyleTag[] })];
    const out = applyWebHints(basePlan(), { prompt: "疾走する曲", dense: false, cards: denseOnly });
    expect(out.sections[0]!.comp).toBe("pad");
    expect(out.sections[0]!.bass).toBe("root");
  });

  it("sets swing only when the plan leaves it at 0", () => {
    const swingCard = [card({ keywords: ["静か"], styleTags: ["swing"] as StyleTag[] })];
    expect(applyWebHints(basePlan(), { prompt: "静かな曲", cards: swingCard }).swing).toBeCloseTo(0.25);
    const swung = PlanSchema.parse({ bpm: 120, key: "C major", swing: 0.33, chords: [[0, "C"]], sections: [{ name: "A", bars: 8 }] });
    expect(applyWebHints(swung, { prompt: "静かな曲", cards: swingCard }).swing).toBe(0.33);
  });

  it("does not touch section styles for orchestra plans", () => {
    const orchestra = PlanSchema.parse({
      bpm: 120,
      key: "C major",
      ensemble: "orchestra",
      chords: [[0, "C"]],
      sections: [{ name: "A", bars: 8 }],
    });
    expect(applyWebHints(orchestra, { prompt: "疾走する曲", dense: true, cards: styleCards }).sections[0]!.comp).toBe("pad");
  });

  it("contains no style tags outside the fixed vocabulary", () => {
    for (const c of webKnowledgeCards) {
      for (const t of c.styleTags ?? []) expect(STYLE_TAGS).toContain(t);
    }
  });
});

describe("cardFitsContext", () => {
  it("filters long-form advice for short songs", () => {
    const modulation = card({ title: "Modulate to shape form", keywords: ["modulation"], advice: ["Use modulation to articulate sections."] });
    expect(cardFitsContext(modulation, { bars: 8 })).toBe(false);
    expect(cardFitsContext(modulation, { bars: 16 })).toBe(true);
  });

  it("filters orchestration advice for bands and dense advice for calm requests", () => {
    const orchestra = card({ title: "Orchestration basics", advice: ["Write idiomatic orchestration."] });
    expect(cardFitsContext(orchestra, { ensemble: "band" })).toBe(false);
    expect(cardFitsContext(orchestra, { ensemble: "orchestra" })).toBe(true);
    const dense = card({ title: "Dense ostinato", advice: ["Drive with a dense ostinato."] });
    expect(cardFitsContext(dense, { calm: true })).toBe(false);
    expect(cardFitsContext(dense, { calm: false })).toBe(true);
  });

  it("is applied by selectWebKnowledge when a context is given", () => {
    const cards = [card({ title: "Modulation", keywords: ["歌"], advice: ["Use modulation."] })];
    expect(selectWebKnowledge("歌", cards, 2, { context: { bars: 8 } })).toEqual([]);
    expect(selectWebKnowledge("歌", cards, 2, { context: { bars: 16 } }).length).toBe(1);
  });
});

describe("mergeKnowledgeCards", () => {
  it("dedupes by title, merges advice/keywords and applies caps", () => {
    const merged = mergeKnowledgeCards(
      [
        card({ title: "Tonic home", advice: ["A"], keywords: ["a"] }),
        card({ title: "tonic home", advice: ["B"], keywords: ["b"], confidence: 0.9 }),
        card({ title: "Other", category: "rhythm", advice: ["C"], keywords: ["c"] }),
      ],
      { maxCards: 10, maxPerCategory: 1 },
    );
    expect(merged.length).toBe(2);
    const tonic = merged.find((c) => c.category === "harmony")!;
    expect(tonic.advice).toEqual(["A", "B"]);
    expect(tonic.keywords).toEqual(["a", "b"]);
  });

  it("limits the total number of cards", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      card({ id: `c${i}`, title: `Title ${i}`, category: i % 2 === 0 ? "harmony" : "melody" }),
    );
    expect(mergeKnowledgeCards(many, { maxCards: 4, maxPerCategory: 8 }).length).toBe(4);
  });
});
