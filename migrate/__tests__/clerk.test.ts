/**
 * Focused tests for the Clerk transform's behavioural guarantees that the fixture
 * corpus can't express as a single before/after pair: the no-op on
 * already-migrated code, that unrelated imports/env vars/locally-named functions
 * are left alone, and that every TODO it emits uses the greppable prefix.
 */
import { describe, it, expect } from "vitest";
import { applyNamedTransform } from "../runner";
import { TODO_PREFIX } from "../transforms/lib/todo";
import { CLERK_ENV_MAP } from "../transforms/lib/clerk-env";

function run(src: string) {
  return applyNamedTransform("clerk", src);
}

describe("clerk transform", () => {
  it("is a no-op on a file with no @clerk usage", () => {
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

  it("maps every documented Clerk env var", () => {
    for (const { from, to } of CLERK_ENV_MAP) {
      const { source } = run(`const v = process.env.${from};\n`);
      expect(source).toContain(`process.env.${to}`);
      expect(source).not.toContain(`process.env.${from}`);
    }
  });

  it("does NOT rewrite a locally-defined auth() not imported from @clerk", () => {
    // A function literally named `auth` that is NOT a Clerk import must be left
    // alone — the transform keys off the import source, not just the name.
    const src = `function auth() { return null; }\nexport const r = auth();\n`;
    const { source, changed } = run(src);
    expect(changed).toBe(false);
    expect(source).not.toContain("getSession");
  });

  it("rewrites Clerk's server auth() to the Better Auth server API", () => {
    const src = `import { auth } from "@clerk/nextjs/server";\nexport async function f() { return auth(); }\n`;
    const { source } = run(src);
    expect(source).toContain("auth.api.getSession");
    expect(source).toContain("await headers()");
    expect(source).toContain('from "@/lib/auth"');
    expect(source).not.toContain("@clerk");
  });

  it("rewrites useUser()/useAuth() to authClient.useSession()", () => {
    const src = `"use client";\nimport { useUser } from "@clerk/nextjs";\nexport function C() { const u = useUser(); return u; }\n`;
    const { source } = run(src);
    expect(source).toContain("authClient.useSession()");
    expect(source).toContain('from "@/lib/auth-client"');
    expect(source).not.toContain("@clerk");
  });

  it("flags Clerk components with a TODO and removes their import", () => {
    const src = `import { UserButton } from "@clerk/nextjs";\nexport function Nav() { return <UserButton />; }\n`;
    const { source } = run(src);
    expect(source).toContain(`${TODO_PREFIX}`);
    expect(source).toContain("UserButton");
    expect(source).not.toContain("@clerk");
  });

  it("flags clerkMiddleware with a proxy.ts TODO", () => {
    const src = `import { clerkMiddleware } from "@clerk/nextjs/server";\nexport default clerkMiddleware();\n`;
    const { source } = run(src);
    expect(source).toContain("src/proxy.ts");
    expect(source).toContain(`${TODO_PREFIX}`);
    expect(source).not.toContain("@clerk");
  });

  it("emits only greppable TODO markers", () => {
    const src = `import { ClerkProvider } from "@clerk/nextjs";\nexport function App() { return <ClerkProvider />; }\n`;
    const { source } = run(src);
    const todoLines = source.split("\n").filter((l) => l.includes("TODO"));
    expect(todoLines.length).toBeGreaterThan(0);
    for (const line of todoLines) {
      expect(line).toContain(TODO_PREFIX);
    }
  });
});
