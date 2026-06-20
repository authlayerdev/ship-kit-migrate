/**
 * Codemod robustness / safety tests (P5 tester edge pass).
 *
 * These prove the migration codemods behave correctly on the inputs a buyer's
 * real repo will throw at them — beyond the single before/after golden each
 * fixture covers:
 *
 *   - applying a transform to ALREADY-MIGRATED Better Auth code is a no-op
 *     (idempotent, no double-transform, no stacked imports/TODOs);
 *   - a file that names `auth` / `getServerSession` / `useSession` LOCALLY (not
 *     imported from next-auth / @clerk) is left UNTOUCHED — a codemod must key
 *     off the import SOURCE, never just the call-site name (the rule: "key
 *     off the import SOURCE so locally-named auth()/useUser() are NOT
 *     rewritten"). A silent wrong rewrite of unrelated code is a serious bug;
 *   - MIXED imports (a @clerk/next-auth import alongside unrelated imports)
 *     transform ONLY the right specifiers and leave the rest intact;
 *   - a malformed / unparseable input FAILS LOUDLY (throws a clear parse error),
 *     never emitting silently-wrong output;
 *   - running the same transform twice yields identical output (idempotency) for
 *     several representative cases.
 *
 * A failing test here means a buyer's tree would be corrupted — fix the
 * transform, never the assertion.
 */
import { describe, it, expect } from "vitest";
import { applyNamedTransform } from "../runner";
import { TODO_PREFIX } from "../transforms/lib/todo";

function nextauth(src: string) {
  return applyNamedTransform("nextauth", src);
}
function clerk(src: string) {
  return applyNamedTransform("clerk", src);
}

// ── Idempotency on already-migrated Better Auth code ──────────────────────────
describe("codemod robustness — idempotent on already-migrated code", () => {
  it("nextauth: re-running on its own output is a no-op (identical, no stacked imports)", () => {
    const input = `import { getServerSession } from "next-auth";\nexport async function f() { return getServerSession(); }\n`;
    const once = nextauth(input).source;
    const second = nextauth(once);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(once);
    // No duplicated kit imports from a second pass.
    expect(second.source.match(/from "@\/lib\/auth"/g)?.length ?? 0).toBe(1);
  });

  it("clerk: re-running on its own output is a no-op (identical, no stacked TODOs)", () => {
    const input = `import { auth } from "@clerk/nextjs/server";\nexport async function f() { return auth(); }\n`;
    const once = clerk(input).source;
    const second = clerk(once);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(once);
    // The SHAPE TODO must appear exactly once, not stacked per pass.
    expect(second.source.match(/TODO\(ship-kit\)/g)?.length ?? 0).toBe(1);
  });

  it("nextauth: hand-written Better Auth code (imports @/lib/auth) is left alone", () => {
    const src = `import { auth } from "@/lib/auth";\nimport { headers } from "next/headers";\nexport async function f() {\n  return auth.api.getSession({ headers: await headers() });\n}\n`;
    const { changed } = nextauth(src);
    expect(changed).toBe(false);
  });

  it("clerk: hand-written Better Auth code (imports @/lib/auth) is left alone", () => {
    const src = `import { auth } from "@/lib/auth";\nimport { headers } from "next/headers";\nexport async function f() {\n  return auth.api.getSession({ headers: await headers() });\n}\n`;
    const { changed } = clerk(src);
    expect(changed).toBe(false);
  });
});

// ── Import-SOURCE safety: never rewrite a locally-named symbol ─────────────────
// A transform must rewrite a call ONLY when the symbol was imported from the
// library it migrates. Rewriting by call-site NAME alone clobbers unrelated
// user code (and even injects a bogus `import { auth } from "@/lib/auth"`).
describe("codemod robustness — keys off the import SOURCE, not the name", () => {
  it("clerk: a locally-defined auth() (no @clerk import) is untouched", () => {
    const src = `function auth() { return { userId: "u_1" }; }\nexport const r = auth();\n`;
    const { source, changed } = clerk(src);
    expect(changed).toBe(false);
    expect(source).not.toContain("getSession");
    expect(source).not.toContain("@/lib/auth");
  });

  it("clerk: a locally-defined useUser() (no @clerk import) is untouched", () => {
    const src = `"use client";\nfunction useUser() { return { user: null }; }\nexport function C() { return useUser(); }\n`;
    const { source, changed } = clerk(src);
    expect(changed).toBe(false);
    expect(source).not.toContain("authClient");
  });

  it("nextauth: a locally-defined getServerSession() (no next-auth import) is untouched", () => {
    // A buyer can legitimately have their own helper called getServerSession that
    // is NOT next-auth's. The transform must not rewrite it, and must NOT inject a
    // bogus `import { auth } from "@/lib/auth"`.
    const src = `function getServerSession() { return null; }\nexport const s = getServerSession();\n`;
    const { source, changed } = nextauth(src);
    expect(changed).toBe(false);
    expect(source).not.toContain("auth.api.getSession");
    expect(source).not.toContain('from "@/lib/auth"');
  });

  it("nextauth: a locally-defined useSession() (no next-auth/react import) is untouched", () => {
    const src = `"use client";\nfunction useSession() { return null; }\nexport function C() { return useSession(); }\n`;
    const { source, changed } = nextauth(src);
    expect(changed).toBe(false);
    expect(source).not.toContain("authClient.useSession");
    expect(source).not.toContain('from "@/lib/auth-client"');
  });

  it("nextauth: a locally-defined NextAuth() (no next-auth import) gets no spurious TODO", () => {
    const src = `function NextAuth(o) { return o; }\nexport const h = NextAuth({});\n`;
    const { source, changed } = nextauth(src);
    expect(changed).toBe(false);
    expect(source).not.toContain(TODO_PREFIX);
  });

  it("nextauth: an unrelated object literal named authOptions gets no spurious TODO", () => {
    // Not imported from next-auth, not a NextAuth config — just a coincidental name.
    const src = `export const authOptions = { retries: 3 };\n`;
    const { source, changed } = nextauth(src);
    expect(changed).toBe(false);
    expect(source).not.toContain(TODO_PREFIX);
  });
});

// ── Mixed imports: transform only the right specifiers ────────────────────────
describe("codemod robustness — mixed imports", () => {
  it("clerk: a @clerk import next to an unrelated import touches only the clerk one", () => {
    const src = `import { auth } from "@clerk/nextjs/server";\nimport { merge } from "lodash";\nexport async function f() {\n  const x = merge({}, {});\n  return auth();\n}\n`;
    const { source, changed } = clerk(src);
    expect(changed).toBe(true);
    // clerk import gone, lodash import + its usage intact, clerk auth() rewritten.
    expect(source).not.toContain("@clerk");
    expect(source).toContain('import { merge } from "lodash"');
    expect(source).toContain("merge({}, {})");
    expect(source).toContain("auth.api.getSession");
  });

  it("nextauth: getServerSession from next-auth next to an unrelated import migrates only it", () => {
    const src = `import { getServerSession } from "next-auth";\nimport { clsx } from "clsx";\nexport async function f() {\n  const c = clsx("a");\n  return getServerSession();\n}\n`;
    const { source, changed } = nextauth(src);
    expect(changed).toBe(true);
    expect(source).not.toContain("next-auth");
    expect(source).toContain('import { clsx } from "clsx"');
    expect(source).toContain('clsx("a")');
    expect(source).toContain("auth.api.getSession");
  });
});

// ── Malformed input must fail loudly, never emit silently-wrong output ─────────
describe("codemod robustness — malformed input fails loudly", () => {
  it("nextauth: throws a clear parse error on unparseable source", () => {
    const bad = `export function f( { return getServerSession() }\n`; // unbalanced
    expect(() => nextauth(bad)).toThrow();
  });

  it("clerk: throws a clear parse error on unparseable source", () => {
    const bad = `const x = {{{ ;`;
    expect(() => clerk(bad)).toThrow();
  });

  it("a parse failure never returns a silently-mutated string", () => {
    const bad = `import { auth } from "@clerk/nextjs/server"\nexport const x = auth(\n`; // truncated call
    let threw = false;
    let result: string | undefined;
    try {
      result = clerk(bad).source;
    } catch {
      threw = true;
    }
    // It must throw; it must NOT return a partially/wrongly transformed string.
    expect(threw).toBe(true);
    expect(result).toBeUndefined();
  });
});

// ── Idempotency on a few more representative shapes ────────────────────────────
describe("codemod robustness — twice == once (idempotency)", () => {
  const cases: ReadonlyArray<readonly [string, "nextauth" | "clerk", string]> = [
    [
      "nextauth env-var rewrite",
      "nextauth",
      `const s = process.env.NEXTAUTH_SECRET;\nconst u = process.env.NEXTAUTH_URL;\n`,
    ],
    [
      "nextauth client useSession",
      "nextauth",
      `"use client";\nimport { useSession } from "next-auth/react";\nexport function C() { const s = useSession(); return s; }\n`,
    ],
    [
      "clerk components (TODO-flagged JSX)",
      "clerk",
      `import { UserButton, SignedIn } from "@clerk/nextjs";\nexport function Nav() { return <SignedIn><UserButton /></SignedIn>; }\n`,
    ],
    [
      "clerk middleware",
      "clerk",
      `import { clerkMiddleware } from "@clerk/nextjs/server";\nexport default clerkMiddleware();\n`,
    ],
    [
      "clerk currentUser server",
      "clerk",
      `import { currentUser } from "@clerk/nextjs/server";\nexport async function f() { const u = await currentUser(); return u; }\n`,
    ],
  ];

  for (const [label, name, src] of cases) {
    it(`${name}: ${label} is idempotent`, () => {
      const once = applyNamedTransform(name, src).source;
      const twice = applyNamedTransform(name, once).source;
      expect(twice).toBe(once);
    });
  }
});
