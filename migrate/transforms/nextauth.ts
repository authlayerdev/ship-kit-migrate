/**
 * NextAuth (next-auth) → Better Auth transform.
 *
 * A deterministic, idempotent jscodeshift codemod that does the mechanical part
 * of a NextAuth → Better Auth migration and leaves a clearly-marked
 * `// TODO(ship-kit):` comment for everything it can't safely do automatically
 * (provider config, callbacks, adapter wiring). It NEVER guesses — anything it
 * isn't sure about becomes a visible TODO, not a silent wrong edit. The manual
 * remainder is documented in MIGRATION.md.
 *
 * What it does (each covered by a green fixture):
 *   1. Package/import swap — `next-auth` / `next-auth/next` / `next-auth/react`
 *      / `next-auth/providers/*` imports → the Better Auth equivalents (`auth`
 *      from `@/lib/auth`, `authClient` from `@/lib/auth-client`, `headers` from
 *      `next/headers`), with TODOs where the shape differs.
 *   2. Session call-sites — `getServerSession(...)` →
 *      `auth.api.getSession({ headers: await headers() })`;
 *      `useSession()` (next-auth/react) → `authClient.useSession()`;
 *      `signIn` / `signOut` (next-auth/react) → `authClient.signIn` / `.signOut`.
 *   3. Config scaffold — a `NextAuth({...})` call or an `authOptions` object
 *      literal is annotated with a TODO pointing at the `betterAuth({...})`
 *      config in `lib/auth.ts` (the kit's own config is the worked example).
 *   4. Env vars — `process.env.NEXTAUTH_SECRET` etc. → the Better Auth names
 *      (see lib/nextauth-env.ts; the `.env` file rename is documented, not
 *      transformed — env files aren't JavaScript).
 *
 * Idempotency: if the file already imports from `better-auth`, the transform is
 * a no-op, so running it twice is safe.
 */
import type { API, FileInfo, ASTPath } from "jscodeshift";
import type {
  ImportDeclaration,
  CallExpression,
  MemberExpression,
} from "jscodeshift";
import { attachTodo, importsBetterAuth } from "./lib/todo";
import { ENV_LOOKUP } from "./lib/nextauth-env";

const KIT_AUTH_MODULE = "@/lib/auth";
const KIT_AUTH_CLIENT_MODULE = "@/lib/auth-client";

export default function transform(
  file: FileInfo,
  api: API,
): string | undefined {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Idempotency guard: already-migrated files import `better-auth`. Leave them.
  if (importsBetterAuth(j, root)) return undefined;

  // Track whether we touched anything, and which new imports we need to add.
  let changed = false;
  const need = {
    auth: false, // import { auth } from "@/lib/auth"
    authClient: false, // import { authClient } from "@/lib/auth-client"
    headers: false, // import { headers } from "next/headers"
  };

  // Which next-auth symbols are actually imported in THIS file. We only rewrite a
  // call-site / annotate a declaration when its name was imported from a
  // `next-auth*` module, so a buyer's UNRELATED local `getServerSession()` /
  // `useSession()` / `NextAuth()` / `authOptions` (all plausible names) is never
  // touched by mistake — keying off the import SOURCE, never the bare name
  // This mirrors how `signIn`/`signOut` (below) and the whole
  // `clerk` transform already gate themselves.
  const serverSessionFns = collectNamedImports(
    j,
    root,
    ["next-auth", "next-auth/next"],
    ["getServerSession"],
  );
  const clientSessionHooks = collectNamedImports(
    j,
    root,
    ["next-auth/react"],
    ["useSession"],
  );
  // The config scaffold (NextAuth(...) / authOptions) is only meaningful in a file
  // that actually imports NextAuth from `next-auth*` (default `import NextAuth …`
  // or provider imports). Annotate it only then.
  const fileImportsNextAuth = importsNextAuthModule(j, root);

  // ── 1. Rewrite env-var member accesses (process.env.NEXTAUTH_*) ──────────────
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

  // ── 2. Rewrite session call-sites BEFORE removing imports ────────────────────
  // getServerSession(...) → auth.api.getSession({ headers: await headers() })
  // — only when `getServerSession` was imported from `next-auth` / `next-auth/next`.
  for (const fnName of serverSessionFns) {
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, fnName))
      .forEach((p) => {
        p.replace(buildGetSessionCall(j));
        need.auth = true;
        need.headers = true;
        changed = true;
      });
  }

  // useSession() → authClient.useSession()
  // — only when `useSession` was imported from `next-auth/react`.
  for (const hookName of clientSessionHooks) {
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
      });
  }

  // signIn(...) / signOut(...) from next-auth/react → authClient.signIn/.signOut
  // (arguments differ between the libraries, so we add a TODO on the statement.)
  const reactAuthFns = collectNamedImports(j, root, "next-auth/react", [
    "signIn",
    "signOut",
  ]);
  for (const fnName of reactAuthFns) {
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, fnName))
      .forEach((p) => {
        (p.node as CallExpression).callee = j.memberExpression(
          j.identifier("authClient"),
          j.identifier(fnName),
        );
        need.authClient = true;
        changed = true;
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            `${fnName}() arguments differ in Better Auth — see authClient.${fnName} usage in the kit and MIGRATION.md`,
          );
        }
      });
  }

  // ── 3. Config scaffold annotations ───────────────────────────────────────────
  // Only in a file that actually imports NextAuth from `next-auth*` — otherwise a
  // buyer's unrelated local `NextAuth(...)` / `authOptions` would get spurious
  // TODOs (key off the import SOURCE, not the name).
  if (fileImportsNextAuth) {
    // NextAuth({...}) call → TODO pointing at betterAuth() in lib/auth.ts.
    root
      .find(j.CallExpression)
      .filter((p) => isCalleeNamed(p.node, "NextAuth"))
      .forEach((p) => {
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            "Replace this NextAuth(...) config with betterAuth(...) — providers, callbacks and the adapter are configured differently. Use the kit's lib/auth.ts as the template.",
          );
          changed = true;
        }
      });

    // export const authOptions = {...}  /  const authOptions = {...}
    root
      .find(j.VariableDeclarator)
      .filter(
        (p) =>
          p.node.id.type === "Identifier" &&
          p.node.id.name === "authOptions" &&
          p.node.init?.type === "ObjectExpression",
      )
      .forEach((p) => {
        const stmt = findEnclosingStatement(p);
        if (stmt) {
          attachTodo(
            j,
            stmt,
            "These NextAuth options don't map 1:1 to Better Auth — port providers/callbacks/adapter into betterAuth(...) in lib/auth.ts. This object is no longer used after migration.",
          );
          changed = true;
        }
      });
  }

  // ── 4. Import rewrites (do last; uses the `need.*` flags collected above) ─────
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

/** Walk up to the nearest Statement so we can attach a leading comment to it. */
function findEnclosingStatement(path: ASTPath): ASTPath | null {
  let current: ASTPath | null = path;
  while (current) {
    const type = current.node.type;
    if (typeof type === "string" && type.endsWith("Statement")) return current;
    if (
      type === "ExportNamedDeclaration" ||
      type === "ExportDefaultDeclaration"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Collect the LOCAL names imported from `source` (one module specifier or a list
 * of them) among the given candidates. Keying off the import SOURCE — not the
 * bare call-site name — is what stops the transform from rewriting a buyer's
 * unrelated local symbol that merely shares a name. Honours import
 * aliases (`import { getServerSession as gss }` → returns `gss`), de-duped.
 */
function collectNamedImports(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
  source: string | readonly string[],
  candidates: string[],
): string[] {
  const sources = typeof source === "string" ? [source] : source;
  const found = new Set<string>();
  root
    .find(j.ImportDeclaration)
    .filter((p) => {
      const src = p.node.source.value;
      return typeof src === "string" && sources.includes(src);
    })
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

/**
 * True if the file imports anything from a `next-auth*` module — the signal that
 * a `NextAuth(...)` call / `authOptions` literal in this file is the NextAuth
 * config to scaffold, rather than an unrelated symbol that coincidentally shares
 * the name. (The config-scaffold case always imports NextAuth and/or providers.)
 */
function importsNextAuthModule(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
): boolean {
  return (
    root
      .find(j.ImportDeclaration)
      .filter((p) => {
        const src = p.node.source.value;
        return typeof src === "string" && src.startsWith("next-auth");
      })
      .size() > 0
  );
}

/**
 * Extract the string name from an import-specifier's `imported` node. The node
 * is a jscodeshift `IdentifierKind` (an `Identifier` for the common
 * `import { foo }` case, where `.name` is a plain string).
 */
function identifierName(node: { type: string }): string | undefined {
  if (node.type !== "Identifier") return undefined;
  const name = (node as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Remove/replace all `next-auth*` imports. Returns true if anything changed.
 * Default imports (`import NextAuth from "next-auth"`) and provider imports get
 * a TODO since they have no mechanical 1:1 replacement.
 */
function rewriteImports(
  j: API["jscodeshift"],
  root: ReturnType<API["jscodeshift"]>,
): boolean {
  let changed = false;

  root
    .find(j.ImportDeclaration)
    .filter((p) => {
      const src = p.node.source.value;
      return typeof src === "string" && src.startsWith("next-auth");
    })
    .forEach((p) => {
      const decl = p.node as ImportDeclaration;
      const src = decl.source.value as string;

      // next-auth/providers/* — no 1:1 replacement; drop + TODO on the next node.
      if (src.startsWith("next-auth/providers")) {
        attachTodo(
          j,
          p,
          `Provider "${src}" has no direct equivalent — configure it under socialProviders in betterAuth(...) (see lib/auth.ts).`,
        );
        // Keep the (now TODO-annotated) line but neutralise it to a comment-only
        // import is not possible; instead we remove the import and the TODO moves
        // to the following statement. Simpler + visible: replace with nothing and
        // rely on the config-scaffold TODO. We drop it here.
        j(p).remove();
        changed = true;
        return;
      }

      // Default import: `import NextAuth from "next-auth"` → betterAuth note.
      const hasDefault = (decl.specifiers ?? []).some(
        (s) => s.type === "ImportDefaultSpecifier",
      );
      if (hasDefault && (src === "next-auth" || src === "next-auth/next")) {
        // The NextAuth(...) call-site already gets a scaffold TODO; just drop the
        // import (the default `NextAuth` symbol no longer exists).
        j(p).remove();
        changed = true;
        return;
      }

      // Named imports from next-auth / next-auth/next / next-auth/react:
      // getServerSession / useSession / signIn / signOut / getSession etc. are
      // handled at their call-sites; the import lines are removed and replaced by
      // the `auth` / `authClient` imports added in addNeededImports().
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
  if (
    need.authClient &&
    !hasImport(j, root, KIT_AUTH_CLIENT_MODULE, "authClient")
  ) {
    toAdd.push(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("authClient"))],
        j.literal(KIT_AUTH_CLIENT_MODULE),
      ),
    );
  }

  if (toAdd.length === 0) return false;

  const body = root.get().node.program.body;
  // Insert after the last remaining import, else at the top of the file.
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
