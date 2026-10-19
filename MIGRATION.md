> **Note (public copy).** This is the migration guide that ships inside [Ship Kit](https://betterauth.app/?utm_source=github&utm_medium=ship-kit-migrate); the codemods in this repository point at it from their `// TODO(ship-kit):` comments. Paths such as `src/lib/auth.ts`, `src/proxy.ts` and `src/components/auth/` refer to the kit's layout — in your own project, substitute your Better Auth config, your route guard and your sign-in UI. Everything about what the codemods do, do not do, and leave for you to decide applies unchanged.

# Migrating to Better Auth with Ship Kit

Ship Kit ships **assisted migration scripts** — deterministic
[jscodeshift](https://github.com/facebook/jscodeshift) codemods that do the
mechanical, repetitive part of moving an existing project onto Better Auth, and
leave a clearly-marked `// TODO(ship-kit):` comment for everything that needs a
human decision.

**These are an assist, not magic.** They are honest about their limits:

- They are **deterministic** — the same input always produces the same output.
- They **fail loudly** — when a codemod can't safely transform something, it
  leaves a visible `// TODO(ship-kit):` comment instead of guessing. There is no
  silent wrong output and **no AI/LLM anywhere in the path**.
- They cover the **boring, high-volume** edits (imports, env vars, session
  call-sites). The **judgement calls** (provider config, callbacks, the database
  adapter, your custom session shape) are left to you, documented below.

After any run, find the remaining manual work with one grep:

```bash
grep -rn "TODO(ship-kit)" .
```

---

## NextAuth → Better Auth

### 1. Run the codemod

From the Ship Kit repo, point the CLI at the project (or subdirectory) you want
to migrate. **Commit or stash first**, and always dry-run before applying:

```bash
# Preview every change without writing anything:
node ./migrate/cli.mjs --transform nextauth --dry ./src

# Apply it (rewrites files in place):
node ./migrate/cli.mjs --transform nextauth ./src
```

(Or via the package script: `pnpm migrate -- --transform nextauth --dry ./src`.)

The codemod is **idempotent** — running it twice is safe; a file it has already
migrated is left untouched.

### 2. What the codemod DOES (each is fixture-tested)

| Area | NextAuth | After the codemod |
| --- | --- | --- |
| **Imports** | `import NextAuth from "next-auth"`, `import { getServerSession } from "next-auth/next"`, `import { useSession, signIn, signOut } from "next-auth/react"`, `import X from "next-auth/providers/*"` | Removed and replaced with `import { auth } from "@/lib/auth"`, `import { headers } from "next/headers"`, and/or `import { authClient } from "@/lib/auth-client"` as needed. |
| **Server session** | `getServerSession(authOptions)` / `getServerSession()` | `auth.api.getSession({ headers: await headers() })` |
| **Client session** | `useSession()` | `authClient.useSession()` |
| **Sign in / out** | `signIn(...)`, `signOut(...)` (from `next-auth/react`) | `authClient.signIn(...)`, `authClient.signOut(...)` — **with a `// TODO(ship-kit):`** because the argument shapes differ. |
| **Env vars in code** | `process.env.NEXTAUTH_SECRET`, `process.env.NEXTAUTH_URL`, `process.env.GITHUB_ID`, `process.env.GITHUB_SECRET`, `process.env.GOOGLE_ID`, `process.env.GOOGLE_SECRET` | Renamed to the Better Auth / Ship Kit names (see the table in §4). Unrelated env vars are left alone. |
| **Config** | `export const authOptions = { ... }`, `NextAuth(authOptions)` | **Annotated** with a `// TODO(ship-kit):` pointing you at `lib/auth.ts`. The codemod does **not** rewrite the config body (see §3). |

#### Before / after — a real server file

```ts
// before
import { getServerSession } from "next-auth/next";

export async function getUser() {
  const session = await getServerSession();
  return session?.user ?? null;
}
```

```ts
// after `--transform nextauth`
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getUser() {
  const session = await auth.api.getSession({
    headers: await headers()
  });
  return session?.user ?? null;
}
```

### 3. What the codemod does NOT do (the manual remainder)

These need your judgement, so the codemod flags them with a TODO rather than
guessing. Use the kit's own [`src/lib/auth.ts`](./src/lib/auth.ts) and
[`src/lib/auth-client.ts`](./src/lib/auth-client.ts) as the worked example — they
are a complete, working Better Auth config.

- **The auth config itself.** Your `authOptions` / `NextAuth({...})` is left in
  place with a TODO. Port it by hand into `betterAuth({...})`:
  - **Providers.** NextAuth's `providers: [GitHubProvider({...})]` becomes
    `socialProviders: { github: { clientId, clientSecret } }`. There is no 1:1
    mechanical mapping (provider option names and shapes differ), so this is
    manual.
  - **Adapter.** Replace your NextAuth adapter with Better Auth's
    `database: drizzleAdapter(db, { provider: "pg", schema })` (the kit already
    wires Drizzle + Postgres).
  - **Callbacks.** NextAuth `callbacks` (`session`, `jwt`, `signIn`) don't map
    onto Better Auth. Better Auth uses `databaseHooks`, plugin options, and
    session customization instead — see the kit's `databaseHooks.session.create`
    for the pattern.
  - **Email/password, verification, reset.** Configure `emailAndPassword` and
    `emailVerification` in `betterAuth({...})` (the kit has both, wired to an
    email transport seam in `lib/email.ts`).
- **`signIn` / `signOut` call arguments.** The function names are rewritten to
  `authClient.signIn` / `authClient.signOut`, but the arguments differ
  (Better Auth uses `authClient.signIn.email({ email, password })`,
  `authClient.signIn.social({ provider })`, etc.). The TODO marks each call;
  match them to the kit's auth UI in `src/components/auth/`.
- **The database schema.** NextAuth's tables (`users`, `accounts`, `sessions`,
  `verification_tokens`) are not Better Auth's. Generate the Better Auth schema
  with `pnpm auth:generate`, then `pnpm db:migrate`. **Migrating existing user
  rows is a data task the codemod does not attempt** — plan it deliberately
  (map columns, preserve password hashes only if the hashing scheme matches, or
  trigger a password reset for existing users).
- **The API route.** NextAuth's `app/api/auth/[...nextauth]/route.ts` is
  replaced by Better Auth's handler (`app/api/auth/[...all]/route.ts` in the
  kit). Delete the old route and use the kit's.
- **`.env` files.** The codemod renames env references **in your code**, but it
  cannot edit `.env` files (they aren't JavaScript). Rename them yourself using
  the table in §4.
- **Middleware / route protection.** NextAuth's `middleware.ts` `withAuth`
  wrapper has no equivalent. The kit guards routes with a cookie check in
  `src/proxy.ts` plus an authoritative server-side `requireSession()` — copy
  that pattern.

### 4. Environment variable mapping (`.env`)

Rename these in your `.env` files (the codemod handles the in-code
`process.env.*` references automatically):

| NextAuth | Better Auth / Ship Kit | Notes |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | `BETTER_AUTH_SECRET` | Same purpose (signs sessions/tokens). Reuse the value or rotate it. |
| `NEXTAUTH_URL` | `BETTER_AUTH_URL` | Your app's base URL. The kit also reads `NEXT_PUBLIC_BETTER_AUTH_URL` on the client. |
| `GITHUB_ID` | `GITHUB_CLIENT_ID` | GitHub OAuth app client id. |
| `GITHUB_SECRET` | `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret. |
| `GOOGLE_ID` | `GOOGLE_CLIENT_ID` | Google OAuth client id. |
| `GOOGLE_SECRET` | `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |

See [`.env.example`](./.env.example) for the full list of variables the kit
expects.

### 5. After migrating — verify

```bash
pnpm typecheck   # surfaces any remaining type holes (e.g. ported call args)
grep -rn "TODO(ship-kit)" .   # the manual checklist the codemod left you
pnpm auth:generate && pnpm db:migrate   # Better Auth schema
pnpm dev         # sign up, verify, log in, log out
```

The migration is complete when there are no `TODO(ship-kit)` markers left,
`pnpm typecheck` is clean, and the auth flows work end-to-end.

---

## Clerk → Better Auth

Clerk is a hosted authentication **product**, not a library, so the gap is wider
than NextAuth's. Clerk's drop-in React components (`<ClerkProvider>`,
`<SignedIn>`, `<UserButton>`, `<SignIn>`/`<SignUp>`) and its hosted user store
have **no 1:1 Better Auth equivalent** — Better Auth ships primitives and the kit
provides its own auth UI and database tables. The codemod is honest about this:
it rewrites the mechanical call-sites and **flags every component, middleware and
hosted-instance concept with a `// TODO(ship-kit):`** pointing at the kit's own
code, rather than emitting plausible-but-wrong replacements.

### 1. Run the codemod

```bash
# Preview every change without writing anything:
node ./migrate/cli.mjs --transform clerk --dry ./src

# Apply it (rewrites files in place):
node ./migrate/cli.mjs --transform clerk ./src
```

(Or via the package script: `pnpm migrate -- --transform clerk --dry ./src`.)

Like the NextAuth transform it is **idempotent** — a file it has already migrated
(or one that no longer imports `@clerk/*`) is left untouched.

### 2. What the codemod DOES (each is fixture-tested)

| Area | Clerk | After the codemod |
| --- | --- | --- |
| **Imports** | `import { auth, currentUser } from "@clerk/nextjs/server"`, `import { useUser, useAuth, UserButton, … } from "@clerk/nextjs"` | The `@clerk/*` imports are removed and replaced with `import { auth } from "@/lib/auth"`, `import { headers } from "next/headers"`, and/or `import { authClient } from "@/lib/auth-client"` as the rewritten call-sites need. Component imports are removed **with a TODO** listing them. |
| **Server session** | `auth()`, `currentUser()` (from `@clerk/nextjs/server`) | `auth.api.getSession({ headers: await headers() })` — **with a `// TODO(ship-kit):`** because the return SHAPE differs (Clerk `auth()` → `{ userId }`, `currentUser()` → the Backend User; Better Auth → `{ user, session }` or `null`). |
| **Client hooks** | `useUser()`, `useAuth()` (from `@clerk/nextjs`) | `authClient.useSession()` — **with a TODO** (Clerk's `{ user, isSignedIn, isLoaded }` / `{ userId, sessionId }` map onto Better Auth's `{ data, isPending, error }` differently). |
| **Components** | `<ClerkProvider>`, `<SignedIn>`/`<SignedOut>`, `<UserButton>`, `<SignIn>`/`<SignUp>`, `<SignInButton>`/`<SignUpButton>`/`<SignOutButton>`, `<Protect>`, `<RedirectToSignIn>` | **Left in place, each annotated with a `// TODO(ship-kit):`** pointing at the kit's auth UI. There is no mechanical swap, so the codemod does not fake one (see §3). |
| **Middleware** | `clerkMiddleware()`, `authMiddleware()` (from `@clerk/nextjs/server`) | **Annotated** with a TODO pointing at the kit's `src/proxy.ts` cookie-check + server-side `requireSession()` pattern (see §3). |
| **Env vars in code** | `process.env.CLERK_SECRET_KEY`, `process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Renamed to the Better Auth / Ship Kit names (see the table in §4). Unrelated env vars are left alone. |

#### Before / after — a real server file

```ts
// before
import { auth, currentUser } from "@clerk/nextjs/server";

export async function getUserId() {
  const { userId } = await auth();
  return userId;
}
```

```ts
// after `--transform clerk`
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getUserId() {
  // TODO(ship-kit): Clerk auth() returned { userId, … }; Better Auth returns { user, session } (or null). Use session?.user?.id and session?.session — see the kit's lib/session.ts / requireSession().
  const { userId } = await auth.api.getSession({
    headers: await headers()
  });
  return userId;
}
```

The `const { userId } = …` destructuring is **intentionally left wrong** (Better
Auth has no top-level `userId`) so the TODO forces you to make the call — the
codemod never silently produces compiling-but-incorrect session reads.

### 3. What the codemod does NOT do (the manual remainder)

Clerk's value is its hosted components and user store; replacing those is a
deliberate rebuild, not a find-and-replace. These are flagged with a TODO:

- **Clerk's UI components.** `<ClerkProvider>` (Better Auth needs no client
  provider — the kit wires the client in `src/lib/auth-client.ts`),
  `<SignedIn>`/`<SignedOut>` (gate on the session instead),
  `<UserButton>` (use the kit's account menu / `sign-out-button.tsx`),
  `<SignIn>`/`<SignUp>` (use the kit's `(auth)` routes + `src/components/auth/`),
  the `<SignInButton>`/`<SignUpButton>`/`<SignOutButton>` triggers, `<Protect>`
  and `<RedirectToSignIn>`. The codemod leaves the JSX in place (so the file
  still parses) and annotates each usage; you replace it with the kit's auth UI.
- **The session shape.** Every `auth()` / `currentUser()` / `useUser()` /
  `useAuth()` rewrite carries a TODO because the field names differ. Map
  `{ userId }` → `session?.user?.id`, the Backend User → `session?.user`, and the
  client `{ user, isSignedIn, isLoaded }` → `{ data, isPending }` from
  `authClient.useSession()`. The kit's `lib/session.ts` / `requireSession()` and
  `src/components/auth/` are the worked examples.
- **Middleware / route protection.** Clerk's `clerkMiddleware()` /
  `authMiddleware()` model has no equivalent. The kit guards routes with a cookie
  check in `src/proxy.ts` plus an authoritative server-side `requireSession()` —
  copy that pattern. (Note: Next.js 16 uses `src/proxy.ts`; on Next ≤15 the file
  is `middleware.ts` with the same code.)
- **The auth config.** Better Auth is configured in `betterAuth({...})`
  (`src/lib/auth.ts`): `emailAndPassword`, `emailVerification`, `socialProviders`,
  and plugins (organization, admin, Stripe). Clerk's dashboard settings (social
  connections, email templates, session options) become this config. Generate the
  schema with `pnpm auth:generate`, then `pnpm db:migrate`.
- **User-data migration.** Clerk stores your users; Better Auth uses your own
  Postgres tables (`user`, `account`, `session`, …). **The codemod does not move
  user rows** — that is a deliberate data task. Export users from the Clerk
  Dashboard (the CSV export includes hashed passwords: `password_digest` is the
  hash, `password_hasher` the algorithm) and import them into `user`, plus one
  `account` row per login method (`providerId: "credential"` with `password` set
  to the digest for password users; the OAuth provider id + `accountId` for
  social users). Clerk hashes with bcrypt and Better Auth defaults to scrypt, so
  add a bcrypt `password.hash` / `password.verify` pair under `emailAndPassword`
  in `src/lib/auth.ts` (the kit does not ship a bcrypt package — install one) and
  existing bcrypt passwords verify as-is, no reset. Check `password_hasher` on
  every row first: a non-bcrypt row cannot be verified that way, so send those
  users through a password reset. Better Auth's Clerk migration guide has a
  worked import script for the rest (its script does not check
  `password_hasher`).
- **The API route.** Clerk has no `[...all]` route; Better Auth mounts its handler
  at `app/api/auth/[...all]/route.ts` (already in the kit). Add it.
- **`.env` files.** The codemod renames env references **in your code**, but it
  cannot edit `.env` files (they aren't JavaScript). Rename / delete them yourself
  using the table in §4.

### 4. Environment variable mapping (`.env`)

Clerk and Better Auth are **not** drop-in at the env level — Clerk's keys
identify a hosted Clerk instance; Better Auth has no SaaS account. Review each
rename by hand:

| Clerk | Better Auth / Ship Kit | Notes |
| --- | --- | --- |
| `CLERK_SECRET_KEY` | `BETTER_AUTH_SECRET` | **Not a 1:1 swap.** Clerk's key authenticates to Clerk's API; Better Auth's secret only signs sessions/tokens. Generate a fresh value (`pnpm dlx @better-auth/cli secret`) — do **not** reuse the Clerk key. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_BETTER_AUTH_URL` | No real equivalent. You most likely **delete** the publishable key and set `NEXT_PUBLIC_BETTER_AUTH_URL` to your app URL. |

**Delete these — they have no Better Auth counterpart** (the kit handles them as
routing config, not env):

| Clerk var | Why / what replaces it |
| --- | --- |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | The kit's sign-in route is `/sign-in` (`src/app/(auth)/sign-in`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | The kit's sign-up route is `/sign-up`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Post-auth redirect is the kit's `callbackURL` / `?redirectTo` flow (`safeRedirectPath`). |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Same as above. |

See [`.env.example`](./.env.example) for the full list of variables the kit
expects.

### 5. After migrating — verify

```bash
pnpm typecheck   # surfaces the session-shape TODOs as type errors to resolve
grep -rn "TODO(ship-kit)" .   # the manual checklist the codemod left you
pnpm auth:generate && pnpm db:migrate   # Better Auth schema
pnpm dev         # sign up, verify, log in, log out
```

Because Clerk's components and user store are a rebuild, expect more manual work
here than a NextAuth move — the codemod's job is to delete the Clerk wiring and
mark every spot you need to touch, not to recreate Clerk on Better Auth.

---

## Honest scope

The codemods cover the mechanical part (imports, env vars, session call-sites) so
you spend your time on what actually needs decisions (provider config, callbacks
→ hooks, the data migration, and — for Clerk — rebuilding the UI on the kit's
components). The NextAuth transform does the larger share automatically because
NextAuth is a library; the Clerk transform does less and **flags more**, because
Clerk's hosted components and user store have no mechanical equivalent and we
won't fake one. Both are a **bonus** that shortens the move to Better Auth; they
are **not** one-click migrators, and we don't pretend otherwise.
