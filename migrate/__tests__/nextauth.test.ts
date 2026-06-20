/**
 * Focused tests for the NextAuth transform's behavioural guarantees that the
 * fixture corpus can't express as a single before/after pair: the no-op on
 * already-migrated code, that unrelated imports/env vars are left alone, and
 * that every TODO it emits uses the greppable prefix.
 */
import { describe, it, expect } from "vitest";
import { applyNamedTransform } from "../runner";
import { TODO_PREFIX } from "../transforms/lib/todo";
import { NEXTAUTH_ENV_MAP } from "../transforms/lib/nextauth-env";

function run(src: string) {
  return applyNamedTransform("nextauth", src);
}

describe("nextauth transform", () => {
  it("is a no-op on a file with no next-auth usage", () => {
    const src = `export const x = 1;\n`;
    const { changed } = run(src);
    expect(changed).toBe(false);
  });

  it("is a no-op on already-migrated code (imports better-auth)", () => {
    const src = `import { auth } from "@/lib/auth";\nexport const x = auth;\n`;
    const { changed } = run(src);
    expect(changed).toBe(false);
  });

  it("leaves unrelated env vars untouched", () => {
    const src = `export const v = process.env.SOME_OTHER_VAR;\n`;
    const { source, changed } = run(src);
    expect(changed).toBe(false);
    expect(source).toContain("SOME_OTHER_VAR");
  });

  it("maps every documented NextAuth env var", () => {
    for (const { from, to } of NEXTAUTH_ENV_MAP) {
      const { source } = run(`const v = process.env.${from};\n`);
      expect(source).toContain(`process.env.${to}`);
      expect(source).not.toContain(`process.env.${from}`);
    }
  });

  it("rewrites getServerSession to the Better Auth server API", () => {
    const src = `import { getServerSession } from "next-auth";\nexport async function f() { return getServerSession(); }\n`;
    const { source } = run(src);
    expect(source).toContain("auth.api.getSession");
    expect(source).toContain("await headers()");
    expect(source).toContain('from "@/lib/auth"');
    expect(source).not.toContain("next-auth");
  });

  it("emits only greppable TODO markers", () => {
    // The config-scaffold TODO only fires for a file that actually imports
    // NextAuth (the transform keys off the import SOURCE, not the bare name —
    // see robustness.test.ts), so the input imports `next-auth`.
    const src = `import NextAuth from "next-auth";\nexport const authOptions = { providers: [] };\nexport default NextAuth(authOptions);\n`;
    const { source } = run(src);
    const todoLines = source
      .split("\n")
      .filter((l) => l.includes("TODO"));
    expect(todoLines.length).toBeGreaterThan(0);
    for (const line of todoLines) {
      expect(line).toContain(TODO_PREFIX);
    }
  });
});
