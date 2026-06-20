/**
 * Clerk (@clerk/nextjs) → Better Auth transform.
 *
 * A deterministic, idempotent jscodeshift codemod that does the mechanical part
 * of a Clerk → Better Auth migration and leaves a clearly-marked
 * `// TODO(ship-kit):` comment for everything it can't safely do automatically.
 * It NEVER guesses — anything it isn't sure about becomes a visible TODO, not a
 * silent wrong edit. The manual remainder is documented in MIGRATION.md.
 *
 * Clerk is a hosted auth PRODUCT, not a library like NextAuth, so the gap is
 * wider: its drop-in React components (`<ClerkProvider>`, `<SignedIn>`,
 * `<UserButton>`, `<SignIn>`/`<SignUp>`) have NO 1:1 Better Auth equivalent —
 * Better Auth ships primitives, and the kit provides its own auth UI. This
 * transform is honest about that: it rewrites the boring, mechanical call-sites
 * and FLAGS every component / middleware / hosted-instance concept with a TODO
 * pointing at the kit's own code, rather than emitting plausible-but-wrong JSX.
 *
 * What it does (each covered by a green fixture):
 *   1. Import swap — `@clerk/nextjs` / `@clerk/nextjs/server` imports → the kit's
 *      Better Auth equivalents (`auth` from `@/lib/auth`, `authClient` from
 *      `@/lib/auth-client`, `headers` from `next/headers`), with TODOs where a
 *      symbol (a component) has no mechanical replacement.
 *   2. Server session — `auth()` and `currentUser()` (from `@clerk/nextjs/server`)
 *      → `auth.api.getSession({ headers: await headers() })` (+ a TODO because the
 *      return SHAPE differs: Clerk's `auth()` yields `{ userId }`, `currentUser()`
 *      the Backend User; Better Auth's session is `{ user, session }`).
 *   3. Client hooks — `useUser()` / `useAuth()` → `authClient.useSession()`
 *      (+ a TODO: Clerk's `{ user, isSignedIn, isLoaded }` / `{ userId, sessionId }`
 *      map onto Better Auth's `{ data, isPending }` differently).
 *   4. Components — `<ClerkProvider>`, `<SignedIn>`/`<SignedOut>`, `<UserButton>`,
 *      `<SignIn>`/`<SignUp>`, `<SignInButton>`/`<SignUpButton>`/`<SignOutButton>`
 *      have no drop-in swap; each usage is annotated with a TODO pointing at the
 *      kit's auth UI (`src/components/auth/`, the (auth) routes). The JSX is left
 *      intact so the file still parses — the buyer replaces it deliberately.
 *   5. Middleware — `clerkMiddleware()` / `authMiddleware()` → a TODO pointing at
 *      the kit's `src/proxy.ts` cookie-check + server-side `requireSession()`
 *      pattern (Clerk's middleware model has no direct equivalent).
 *   6. Env vars — `process.env.CLERK_SECRET_KEY` etc. → the Better Auth names
 *      (see lib/clerk-env.ts; the `.env` file rename is documented, not
 *      transformed — env files aren't JavaScript — and several Clerk vars have NO
 *      equivalent and are listed for deletion in MIGRATION.md).
 *
 * Idempotency: if the file already imports from `better-auth` OR no longer
 * imports anything from `@clerk/*`, the relevant rewrites are no-ops, so running
 * it twice is safe. TODO markers are de-duplicated by `attachTodo`.
 */
import type { API, FileInfo, ASTPath } from "jscodeshift";
import type {
  ImportDeclaration,
  CallExpression,
  MemberExpression,
  JSXElement,
  JSXIdentifier,
} from "jscodeshift";
import { attachTodo, importsBetterAuth } from "./lib/todo";
import { ENV_LOOKUP } from "./lib/clerk-env";

const KIT_AUTH_MODULE = "@/lib/auth";
const KIT_AUTH_CLIENT_MODULE = "@/lib/auth-client";

/** Clerk server symbols (from `@clerk/nextjs/server`) we rewrite at call-sites. */
const SERVER_SESSION_FNS = ["auth", "currentUser"] as const;
/** Clerk client hooks (from `@clerk/nextjs`) we rewrite at call-sites. */
const CLIENT_HOOKS = ["useUser", "useAuth"] as const;
/** Clerk middleware factories (from `@clerk/nextjs/server`). */
const MIDDLEWARE_FNS = ["clerkMiddleware", "authMiddleware"] as const;

/**
 * Clerk drop-in components (from `@clerk/nextjs`) with NO Better Auth equivalent.
 * Each is flagged with a TODO pointing at the kit's own auth UI; the JSX is left
 * in place (so the file still parses) for the buyer to replace deliberately.
 */
const COMPONENT_GUIDANCE: Record<string, string> = {
  ClerkProvider:
    "<ClerkProvider> has no Better Auth equivalent — Better Auth needs no client provider. Remove this wrapper; the kit wires the auth client in src/lib/auth-client.ts.",
  SignedIn:
    "<SignedIn> has no drop-in replacement — gate on the session instead: read authClient.useSession() (client) or auth.api.getSession (server) and render conditionally. See the kit's src/components/auth/ and (dashboard) guards.",
  SignedOut:
    "<SignedOut> has no drop-in replacement — render based on the ABSENCE of a session (see <SignedIn> note). See src/components/auth/.",
  UserButton:
    "<UserButton> has no drop-in replacement — use the kit's account menu / SignOutButton in src/components/ and src/components/auth/sign-out-button.tsx.",
  SignIn:
    "<SignIn> has no drop-in replacement — use the kit's sign-in page at src/app/(auth)/sign-in and src/components/auth/.",
  SignUp:
    "<SignUp> has no drop-in replacement — use the kit's sign-up page at src/app/(auth)/sign-up and src/components/auth/.",
  SignInButton:
    "<SignInButton> has no drop-in replacement — link to the kit's /sign-in route or call authClient.signIn.* from src/components/auth/.",
  SignUpButton:
    "<SignUpButton> has no drop-in replacement — link to the kit's /sign-up route or call authClient.signUp.email from src/components/auth/.",
  SignOutButton:
    "<SignOutButton> has no drop-in replacement — use the kit's src/components/auth/sign-out-button.tsx (authClient.signOut).",
  RedirectToSignIn:
    "<RedirectToSignIn> has no drop-in replacement — redirect to the kit's /sign-in route (the kit's server guards use redirect(\"/sign-in?redirectTo=…\")).",
  Protect:
    "<Protect> has no drop-in replacement — gate with the kit's server-side guards (requireSession / requireOrgPermission) instead of a component.",
};

export default function transform(file: FileInfo, api: API): string | undefined {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Idempotency guard: already-migrated files import `better-auth`. Leave them.
  if (importsBetterAuth(j, root)) return undefined;

  let changed = false;
  const need = {
    auth: false, // import { auth } from "@/lib/auth"
    authClient: false, // import { authClient } from "@/lib/auth-client"
    headers: false, // import { headers } from "next/headers"
  };

  // Which Clerk symbols are actually imported in THIS file. We only rewrite a
  // call-site if its name was imported from a `@clerk/*` module, so an unrelated
  // local `auth()` (very plausible name) is never touched by mistake.
  const importedServerFns = collectClerkImports(j, root, [...SERVER_SESSION_FNS]);
  const importedClientHooks = collectClerkImports(j, root, [...CLIENT_HOOKS]);
  const importedMiddlewareFns = collectClerkImports(j, root, [...MIDDLEWARE_FNS]);

  // ── 1. Rewrite env-var member accesses (process.env.CLERK_* etc.) ────────────
  root
    .find(j.MemberExpression)
    .filter((p) => isProcessEnvAccess(p.node))
    .forEach((p) => {
      const prop = p.node.property;
      if (prop.type !== "Identifier") return;
      const mapping = ENV_LOOKUP.get(prop.name);
      if (!mapping) return;
      prop.name = mapping.to;
      changed = true;
    });

  // ── 2. Server session call-sites (auth(), currentUser()) ─────────────────────
  // Both → auth.api.getSession({ headers: await headers() }) with a SHAPE TODO,
  // because Clerk's auth()/currentUser() return different shapes than BA's session.
  for (const fnName of importedServerFns) {
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, fnName))
      .forEach((p) => {
        p.replace(buildGetSessionCall(j));
        need.auth = true;
        need.headers = true;
        changed = true;
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            fnName === "currentUser"
              ? "Clerk currentUser() returned the full user; Better Auth's session.user has different fields. Read session?.user and map fields — see the kit's lib/session.ts / requireSession()."
              : "Clerk auth() returned { userId, … }; Better Auth returns { user, session } (or null). Use session?.user?.id and session?.session — see the kit's lib/session.ts / requireSession().",
          );
        }
      });
  }

  // ── 3. Client hooks (useUser(), useAuth()) → authClient.useSession() ─────────
  for (const hookName of importedClientHooks) {
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, hookName))
      .forEach((p) => {
        (p.node as CallExpression).callee = j.memberExpression(
          j.identifier("authClient"),
          j.identifier("useSession"),
        );
        need.authClient = true;
        changed = true;
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            `Clerk ${hookName}() returned ${
              hookName === "useUser"
                ? "{ isLoaded, isSignedIn, user }"
                : "{ userId, sessionId, isLoaded, isSignedIn, signOut }"
            }; authClient.useSession() returns { data, isPending, error }. Read data?.user / data?.session and isPending — see the kit's src/components/auth/.`,
          );
        }
      });
  }

  // ── 4. Components — annotate every Clerk component usage with a TODO ──────────
  // The JSX is left intact (so the file still parses); the buyer replaces it with
  // the kit's auth UI. We annotate the nearest statement of each usage.
  root
    .find(j.JSXElement)
    .forEach((p) => {
      const name = jsxElementName(p.node);
      if (!name) return;
      const guidance = COMPONENT_GUIDANCE[name];
      if (!guidance) return;
      const stmt = findEnclosingStatement(p);
      if (stmt) {
        attachTodo(j, stmt, guidance);
        changed = true;
      }
    });

  // ── 5. Middleware — clerkMiddleware()/authMiddleware() → src/proxy.ts TODO ───
  for (const fnName of importedMiddlewareFns) {
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, fnName))
      .forEach((p) => {
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            `${fnName}() has no Better Auth equivalent. Replace this with the kit's edge cookie-check in src/proxy.ts plus an authoritative server-side requireSession() in your protected routes/layouts. See MIGRATION.md (middleware).`,
          );
          changed = true;
        }
      });
  }

  // ── 6. Import rewrites (do last; uses the `need.*` flags collected above) ─────
  changed = rewriteImports(j, root) || changed;
  changed = addNeededImports(j, root, need) || changed;

  if (!changed) return undefined;
  return root.toSource({ quote: "double" });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isProcessEnvAccess(node: MemberExpression): boolean {
  return (
    node.object.type === "MemberExpression" &&
    node.object.object.type === "Identifier" &&
    node.object.object.name === "process" &&
    node.object.property.type === "Identifier" &&
    node.object.property.name === "env"
  );
}

function isCalleeNamed(node: CallExpression, name: string): boolean {
  return node.callee.type === "Identifier" && node.callee.name === name;
}

/** Build `auth.api.getSession({ headers: await headers() })`. */
function buildGetSessionCall(j: API["jscodeshift"]): CallExpression {
  return j.callExpression(
    j.memberExpression(
      j.memberExpression(j.identifier("auth"), j.identifier("api")),
      j.identifier("getSession"),
    ),
    [
      j.objectExpression([
        j.property(
          "init",
          j.identifier("headers"),
          j.awaitExpression(j.callExpression(j.identifier("headers"), [])),
        ),
      ]),
    ],
  );
}

/** The element name of a JSX element (only handles a plain `<Name>`; ignores `<a.b>`). */
function jsxElementName(node: JSXElement): string | undefined {
  const opening = node.openingElement;
  if (opening.name.type !== "JSXIdentifier") return undefined;
  return (opening.name as JSXIdentifier).name;
}

/**
 * Walk up to the nearest node a leading comment reads cleanly on: a real
 * Statement (e.g. `ReturnStatement`), a top-level declaration
 * (`VariableDeclaration` — `const x = await auth()` — which is NOT named
 * `*Statement`), or an export. We deliberately recognise `VariableDeclaration`
 * before the enclosing `BlockStatement` so a TODO lands ON the
 * `const … = …` line rather than splitting a function signature across its
 * opening brace.
 */
function findEnclosingStatement(path: ASTPath): ASTPath | null {
  let current: ASTPath | null = path;
  while (current) {
    const type = current.node.type;
    if (typeof type === "string" && type.endsWith("Statement")) return current;
    if (
      type === "VariableDeclaration" ||
      type === "ExportNamedDeclaration" ||
      type === "ExportDefaultDeclaration"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Collect the local names imported from any `@clerk/*` module among `candidates`. */
function collectClerkImports(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
  candidates: string[],
): string[] {
  const found = new Set<string>();
  root
    .find(j.ImportDeclaration)
    .filter((p) => isClerkSource(p.node.source.value))
    .forEach((p) => {
      for (const spec of p.node.specifiers ?? []) {
        if (spec.type !== "ImportSpecifier") continue;
        const importedName = identifierName(spec.imported);
        if (importedName && candidates.includes(importedName)) {
          const localName = spec.local ? identifierName(spec.local) : undefined;
          found.add(localName ?? importedName);
        }
      }
    });
  return [...found];
}

function isClerkSource(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("@clerk/");
}

/**
 * Extract the string name from an import-specifier's `imported` node (a plain
 * `Identifier` for the common `import { foo }` case).
 */
function identifierName(node: { type: string }): string | undefined {
  if (node.type !== "Identifier") return undefined;
  const name = (node as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Remove all `@clerk/*` imports. Returns true if anything changed. Imports of
 * Clerk COMPONENTS (which the buyer must replace by hand) get a TODO on the
 * import line itself so the dangling JSX has a paper-trail even after the import
 * is gone. The `auth` / `authClient` / `headers` imports the call-site rewrites
 * need are added separately in addNeededImports().
 */
function rewriteImports(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
): boolean {
  let changed = false;

  root
    .find(j.ImportDeclaration)
    .filter((p) => isClerkSource(p.node.source.value))
    .forEach((p) => {
      const decl = p.node as ImportDeclaration;

      // If this import brought in any component, leave a TODO listing them so the
      // (now-undefined) JSX usages below have a clear breadcrumb at the top.
      const componentNames = (decl.specifiers ?? [])
        .filter((s) => s.type === "ImportSpecifier")
        .map((s) => identifierName((s as { imported: { type: string } }).imported))
        .filter((n): n is string => !!n && n in COMPONENT_GUIDANCE);

      if (componentNames.length > 0) {
        attachTodo(
          j,
          p,
          `Removed Clerk component import(s): ${componentNames.join(
            ", ",
          )}. These have no Better Auth equivalent — replace the matching JSX with the kit's auth UI (src/components/auth/). See MIGRATION.md (components).`,
        );
      }

      j(p).remove();
      changed = true;
    });

  return changed;
}

/** Add the `auth` / `authClient` / `headers` imports the rewrites now require. */
function addNeededImports(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
  need: { auth: boolean; authClient: boolean; headers: boolean },
): boolean {
  const toAdd: ImportDeclaration[] = [];

  if (need.auth && !hasImport(j, root, KIT_AUTH_MODULE, "auth")) {
    toAdd.push(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("auth"))],
        j.literal(KIT_AUTH_MODULE),
      ),
    );
  }
  if (need.headers && !hasImport(j, root, "next/headers", "headers")) {
    toAdd.push(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("headers"))],
        j.literal("next/headers"),
      ),
    );
  }
  if (need.authClient && !hasImport(j, root, KIT_AUTH_CLIENT_MODULE, "authClient")) {
    toAdd.push(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("authClient"))],
        j.literal(KIT_AUTH_CLIENT_MODULE),
      ),
    );
  }

  if (toAdd.length === 0) return false;

  const body = root.get().node.program.body;
  let lastImportIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i].type === "ImportDeclaration") lastImportIdx = i;
  }
  body.splice(lastImportIdx + 1, 0, ...toAdd);
  return true;
}

function hasImport(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
  source: string,
  name: string,
): boolean {
  return (
    root
      .find(j.ImportDeclaration)
      .filter((p) => p.node.source.value === source)
      .find(j.ImportSpecifier)
      .filter((s) => identifierName(s.node.imported) === name)
      .size() > 0
  );
}
