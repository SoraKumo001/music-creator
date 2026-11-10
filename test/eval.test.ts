import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAll, evaluateFixture, type EvalFixture } from "../src/eval/harmony";
import { PlanSchema } from "../src/plan";

function loadFixtures(): EvalFixture[] {
  const dir = "test/fixtures/plans";
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as { name?: string; bars?: number; plan: unknown };
      return { name: raw.name ?? file.replace(/\.json$/, ""), bars: raw.bars ?? 8, plan: PlanSchema.parse(raw.plan) };
    });
}

const fixtures = loadFixtures();
const byName = (name: string) => fixtures.find((f) => f.name === name)!;

describe("eval corpus", () => {
  it("has at least 10 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it("good fixtures are clean after repair", () => {
    for (const fixture of fixtures.filter((f) => !f.name.startsWith("bad-"))) {
      const row = evaluateFixture(fixture);
      expect({ name: fixture.name, errors: row.errorsAfter }).toEqual({ name: fixture.name, errors: 0 });
      expect({ name: fixture.name, cadence: row.cadence }).not.toEqual({ name: fixture.name, cadence: "none" });
      expect({ name: fixture.name, tonic: row.endingTonic }).toEqual({ name: fixture.name, tonic: true });
    }
  });

  it("repairs the deliberately broken fixtures", () => {
    const retro = evaluateFixture(byName("bad-retrogression"));
    expect(retro.repairs).toBeGreaterThan(0);
    expect(retro.issuesAfter).toBeLessThan(retro.issuesBefore);

    const notonic = evaluateFixture(byName("bad-notonic"));
    expect(notonic.endingTonic).toBe(true);
    expect(notonic.issuesAfter).toBeLessThan(notonic.issuesBefore);

    const sparse = evaluateFixture(byName("bad-sparse"));
    expect(sparse.issuesAfter).toBeLessThanOrEqual(sparse.issuesBefore);
  });

  it("summarises rates", () => {
    const { summary } = evaluateAll(fixtures);
    expect(summary.cadenceRate).toBeGreaterThanOrEqual(0.9);
    expect(summary.endingTonicRate).toBeGreaterThanOrEqual(0.9);
    expect(summary.diatonicRate).toBeGreaterThanOrEqual(0.85);
    expect(summary.errorRateAfter).toBe(0);
  });
});
