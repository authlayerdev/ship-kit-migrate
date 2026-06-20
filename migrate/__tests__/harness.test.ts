/**
 * Codemod fixture-corpus test.
 *
 * Runs every registered transform against every golden fixture pair and asserts
 * the transform output equals the expected output EXACTLY. This is the
 * regression net for the migration scripts and runs in `pnpm test:unit` /
 * `pnpm test:codemods`, i.e. in CI.
 *
 * Idempotency is asserted too: running a transform a second time on its own
 * output must be a no-op. A non-idempotent codemod (e.g. one that re-adds an
 * import on every pass) would corrupt a buyer's file if run twice — so it fails
 * here instead of in their repo.
 */
import { describe, it, expect } from "vitest";
import { loadCorpus, runFixture } from "../fixtures";
import { applyNamedTransform } from "../runner";
import { readFileSync } from "node:fs";

const corpus = loadCorpus();

describe("codemod fixture corpus", () => {
  it("discovers fixtures", () => {
    // Guards against a silently-empty corpus (e.g. a glob/path regression):
    // an empty run would otherwise be a false green.
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const fixture of corpus) {
    it(`${fixture.transform} › ${fixture.name}`, () => {
      const { actual, expected } = runFixture(fixture);
      expect(actual).toBe(expected);
    });

    it(`${fixture.transform} › ${fixture.name} (idempotent)`, () => {
      const input = readFileSync(fixture.inputPath, "utf8");
      const once = applyNamedTransform(fixture.transform, input).source;
      const twice = applyNamedTransform(fixture.transform, once).source;
      expect(twice).toBe(once);
    });
  }
});
