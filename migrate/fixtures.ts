/**
 * Fixture-corpus harness.
 *
 * Each transform owns a directory of golden fixtures:
 *
 *   transforms/__testfixtures__/<transform>/<case>.input.ts
 *   transforms/__testfixtures__/<transform>/<case>.output.ts
 *
 * `loadCorpus()` discovers every pair and `runFixture()` applies the transform
 * to an input and returns the actual output next to the expected output, so the
 * Vitest harness can assert exact equality. This is the same input→output golden
 * model jscodeshift's own `testUtils.defineTest` uses, run natively under Vitest
 * (no Jest globals) so it executes inside `pnpm test:unit` / `pnpm test:codemods`
 * and therefore in CI.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTransform } from "./runner";
import { getTransform } from "./registry";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "transforms", "__testfixtures__");

export interface FixtureCase {
  /** Transform registry name (the corpus subdirectory). */
  readonly transform: string;
  /** Fixture case name (the file stem before `.input`/`.output`). */
  readonly name: string;
  /** Absolute path to the `.input.*` file. */
  readonly inputPath: string;
  /** Absolute path to the `.output.*` file. */
  readonly outputPath: string;
}

const INPUT_RE = /\.input\.(tsx?|jsx?)$/;

/** Discover every fixture pair under `__testfixtures__/<transform>/`. */
export function loadCorpus(): FixtureCase[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  const cases: FixtureCase[] = [];

  for (const transform of readdirSync(FIXTURES_ROOT, { withFileTypes: true })) {
    if (!transform.isDirectory()) continue;
    const dir = join(FIXTURES_ROOT, transform.name);

    for (const file of readdirSync(dir)) {
      const match = file.match(INPUT_RE);
      if (!match) continue;
      const ext = match[1];
      const name = file.slice(0, file.length - `.input.${ext}`.length);
      const inputPath = join(dir, file);
      const outputPath = join(dir, `${name}.output.${ext}`);
      if (!existsSync(outputPath)) {
        throw new Error(
          `Fixture "${transform.name}/${name}" is missing its expected output file: ${outputPath}`,
        );
      }
      cases.push({ transform: transform.name, name, inputPath, outputPath });
    }
  }

  // Stable order so test output is deterministic across platforms.
  cases.sort((a, b) =>
    a.transform === b.transform
      ? a.name.localeCompare(b.name)
      : a.transform.localeCompare(b.transform),
  );
  return cases;
}

export interface FixtureRun {
  /** What the transform actually produced. */
  readonly actual: string;
  /** What the `.output` fixture says it should produce. */
  readonly expected: string;
  /** The original input (for diagnostics). */
  readonly input: string;
}

/** Run a single fixture case and return actual vs expected (both normalised). */
export function runFixture(fixture: FixtureCase): FixtureRun {
  const entry = getTransform(fixture.transform);
  if (!entry) {
    throw new Error(
      `Fixture references unknown transform "${fixture.transform}" — register it in registry.ts.`,
    );
  }
  const input = readFileSync(fixture.inputPath, "utf8");
  const expected = readFileSync(fixture.outputPath, "utf8");
  const { source } = applyTransform(entry.transform, input, {
    path: fixture.inputPath,
  });
  return {
    actual: normalise(source),
    expected: normalise(expected),
    input,
  };
}

/**
 * Normalise trailing whitespace and line endings so a fixture authored on
 * Windows (CRLF) and a transform output (LF from the printer) compare cleanly,
 * and a stray trailing newline never fails an otherwise-correct transform.
 */
function normalise(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
}
