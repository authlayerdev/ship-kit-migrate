# Ship Kit migration scripts (`ship-kit-migrate`)

**Assisted, deterministic codemods** that help you move an existing project to
[Better Auth](https://www.better-auth.com). They are **not magic** and **not an
AI migrator**: every transform is a boring, idempotent, fixture-tested
[jscodeshift](https://github.com/facebook/jscodeshift) codemod that either makes
a change it is sure about, or leaves a clearly-marked `// TODO(ship-kit):`
comment for you to resolve by hand. Whatever a codemod can't safely transform is
documented as a manual step — see [`MIGRATION.md`](https://betterauth.app).

> These scripts run on **your** source code. They are shipped as a bonus on top
> of Ship Kit; the kit itself is a complete, working Better Auth app you can use
> as the destination shape.

## Quick start

From the Ship Kit repo root, point the CLI at the project you want to migrate.

```bash
# See what's available:
node ./migrate/cli.mjs --help

# Dry run first — preview the diff without writing anything:
node ./migrate/cli.mjs --transform <name> --dry <path>

# Apply it (writes changes in place):
node ./migrate/cli.mjs --transform <name> <path>
```

You can also run it through the package script:

```bash
pnpm migrate -- --transform <name> --dry <path>
```

## What's here

```
migrate/
  cli.mjs                 # buyer-facing CLI entry (--transform, --dry, --help)
  runner.ts               # programmatic API: applyTransform(transform, source)
  registry.ts             # the list of available transforms (add new ones here)
  fixtures.ts             # the fixture-corpus harness (used by Vitest)
  types.ts                # shared transform types + forced TSX parser
  transforms/
    identity.ts           # no-op transform; proves the harness/CLI end-to-end
    nextauth.ts           # NextAuth → Better Auth (see https://betterauth.app)
    clerk.ts              # Clerk → Better Auth (see https://betterauth.app)
    lib/                  # transform helpers (TODO markers, env mapping)
    __testfixtures__/
      identity/*.input.ts + *.output.ts
      nextauth/*.input.ts + *.output.ts
      clerk/*.input.ts + *.output.ts
  __tests__/
    harness.test.ts       # runs every transform against its fixture corpus
    nextauth.test.ts      # focused behavioural tests for the NextAuth transform
    clerk.test.ts         # focused behavioural tests for the Clerk transform
```

## Available transforms

| Name       | What it does                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| `nextauth` | NextAuth (next-auth) → Better Auth: imports, session call-sites, env vars, config-scaffold TODOs. Full guide: [`MIGRATION.md`](https://betterauth.app). |
| `clerk`    | Clerk (@clerk/nextjs) → Better Auth: imports, `auth()`/`currentUser()`/`useUser()`/`useAuth()` call-sites, env vars, and component/middleware TODOs. Full guide: [`MIGRATION.md`](https://betterauth.app). |
| `identity` | No-op round-trip (proves the harness/CLI; useful for smoke tests)              |

Each transform ships with its own fixture corpus and a section in the top-level
migration guide. The Clerk transform deliberately does **less** automatically and
**flags more** than the NextAuth one — Clerk's hosted UI components and user store
have no mechanical equivalent, so it removes the Clerk wiring and marks every spot
to rebuild rather than guessing.

```bash
# Migrate a NextAuth project (dry run first):
node ./migrate/cli.mjs --transform nextauth --dry ./src
node ./migrate/cli.mjs --transform nextauth ./src

# Migrate a Clerk project (dry run first):
node ./migrate/cli.mjs --transform clerk --dry ./src
node ./migrate/cli.mjs --transform clerk ./src
```

## Adding a transform

1. Write `migrate/transforms/<name>.ts` exporting a jscodeshift transform as
   `default` (signature `(file, api, options) => string | null | undefined`).
2. Register it in `migrate/registry.ts`.
3. Drop one or more fixture pairs in
   `migrate/transforms/__testfixtures__/<name>/<case>.input.ts` and
   `.output.ts`. The harness discovers them automatically.
4. `pnpm test:codemods` — input must transform to exactly the output fixture,
   and twice must equal once (idempotency).

The corpus is the regression net: a transform is only as trustworthy as the
shapes it has a green fixture for. Include at least one "can't fully transform →
leaves a TODO" case so the honest-coverage promise stays honest.

## Why jscodeshift (and not an LLM)

Migrations must be **deterministic** and **testable**. A jscodeshift codemod
produces the same output for the same input every time, fails loudly when it
hits a shape it doesn't understand (leaving a `// TODO(ship-kit):` rather than
guessing), and is pinned to a fixture corpus that runs in CI. An AI migrator
would be non-deterministic, an uptime/cost dependency, and a support nightmare —
exactly what these scripts are designed to avoid.
