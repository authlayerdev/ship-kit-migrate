# ship-kit-migrate

[![tests](https://github.com/authlayerdev/ship-kit-migrate/actions/workflows/test.yml/badge.svg)](https://github.com/authlayerdev/ship-kit-migrate/actions/workflows/test.yml)

Deterministic, fixture-tested [jscodeshift](https://github.com/facebook/jscodeshift) codemods that do the **mechanical** part of migrating a Next.js app from **NextAuth** or **Clerk** to [Better Auth](https://www.better-auth.com).

> **Independent & unofficial.** This tool and Ship Kit are independent projects and are **not** affiliated with, sponsored by, or endorsed by the Better Auth project. "Better Auth" is a separate open-source library.

**Free and MIT-licensed.** These are the same migration codemods that ship with [Ship Kit](https://betterauth.app/?utm_source=github&utm_medium=ship-kit-migrate) — a paid Better Auth starter for Next.js (disclosure: I make and sell it). They're open-sourced so you can use them, read them, and trust them whether or not you ever buy anything.

## What this is (and isn't)

The full migration guide — what each codemod does, what it deliberately does not do, and the manual remainder (`// TODO(ship-kit):` by `// TODO(ship-kit):`) — is in [MIGRATION.md](./MIGRATION.md).


- **Deterministic** — the same input always produces the same output. **No AI/LLM** anywhere in the path.
- **Honest about its limits** — when a transform can't safely rewrite something, it leaves a visible `// TODO(ship-kit):` comment instead of guessing. It handles the **boring, high-volume** edits (imports, env-var names, session call-sites); the judgement calls (provider config, callbacks, the data migration) stay yours. It is an **assist, not a one-click migrator**.

## Install & quick start

```bash
git clone https://github.com/authlayerdev/ship-kit-migrate.git
cd ship-kit-migrate
npm install        # or: pnpm install

# Preview every change without writing anything:
node ./migrate/cli.mjs --transform nextauth --dry /path/to/your-app/src

# Apply it (rewrites files in place — commit or stash first):
node ./migrate/cli.mjs --transform nextauth /path/to/your-app/src
```

See all options with `node ./migrate/cli.mjs --help`. The codemods are **idempotent** — running twice is safe. After a run, find the manual remainder with one grep:

```bash
grep -rn "TODO(ship-kit)" .
```

## Transforms

| Name | What it does |
| ---- | ------------ |
| `nextauth` | NextAuth → Better Auth: imports, `getServerSession` → `auth.api.getSession`, `useSession` → `authClient.useSession`, `signIn`/`signOut` references, env-var renames, and a config-scaffold TODO. |
| `clerk` | Clerk → Better Auth: imports, `auth()` / `currentUser()` / `useUser()` / `useAuth()` call-sites, env vars, and component/middleware TODOs. Clerk's hosted UI has no mechanical equivalent, so it flags more and rewrites less. |
| `identity` | No-op round-trip — a smoke test that proves the harness/CLI end to end. |

Each transform ships with its own fixture corpus.

## What it does NOT do (the manual remainder)

The codemods cover the mechanical part. You still do, by hand: the auth config body (providers, the database adapter, callbacks → hooks), the `signIn`/`signOut` **argument** shapes, the database schema + the **user-data migration** (password hashes carry over if Better Auth is configured to verify the same hashing scheme, e.g. bcrypt for a Clerk export; otherwise plan a reset), the API route move, the `.env` file edits, and middleware → a server-side `requireSession`. Step-by-step guides for each live at [betterauth.app](https://betterauth.app/?utm_source=github&utm_medium=ship-kit-migrate).

## Tests

```bash
npm test     # vitest — every transform against its fixture corpus (equality + idempotency)
```

The fixture corpus is the regression net: a transform is only trusted for the shapes it has a green fixture for, including "can't fully transform → leaves a TODO" cases.

## Why jscodeshift, not an LLM

Migrations must be **deterministic** and **testable**. A jscodeshift codemod produces the same output for the same input every time, fails loudly (a `// TODO(ship-kit):`) when it hits a shape it doesn't understand, and is pinned to a fixture corpus that runs in CI. An AI migrator would be non-deterministic, an uptime/cost dependency, and a support nightmare — exactly what these scripts are designed to avoid.

## Support

Best-effort. This is a free tool maintained by a solo developer alongside Ship Kit — issues and PRs are welcome and triaged as time allows. Fixes come with a fixture, so the corpus only grows.

## License

[MIT](./LICENSE). Built as part of [Ship Kit](https://betterauth.app/?utm_source=github&utm_medium=ship-kit-migrate), a production-ready Better Auth starter for Next.js (organizations, org-level billing, an admin panel — and these codemods), sold separately. The codemods here are free; the kit is the paid, wired-and-tested destination they migrate you toward.
