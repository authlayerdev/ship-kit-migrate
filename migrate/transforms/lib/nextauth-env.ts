/**
 * NextAuth → Better Auth environment-variable mapping.
 *
 * This is the single source of truth for how common NextAuth env vars map onto
 * Better Auth names. It is:
 *   1. applied in code by the `nextauth` transform (rewriting `process.env.X`
 *      member accesses), and
 *   2. documented in MIGRATION.md as the `.env` rename table (the transform
 *      can't edit `.env` files — they aren't JavaScript).
 *
 * Provider credentials (GITHUB_ID / GITHUB_SECRET / GOOGLE_ID / GOOGLE_SECRET …)
 * are deliberately mapped to the kit's `*_CLIENT_ID` / `*_CLIENT_SECRET`
 * convention so they line up with `lib/auth.ts`'s `socialProviders()`.
 */
export interface EnvMapping {
  readonly from: string;
  readonly to: string;
  readonly note: string;
}

export const NEXTAUTH_ENV_MAP: readonly EnvMapping[] = [
  {
    from: "NEXTAUTH_SECRET",
    to: "BETTER_AUTH_SECRET",
    note: "Same purpose (signs sessions/tokens). Reuse the value or rotate it.",
  },
  {
    from: "NEXTAUTH_URL",
    to: "BETTER_AUTH_URL",
    note: "Your app's base URL. Better Auth also reads NEXT_PUBLIC_BETTER_AUTH_URL on the client.",
  },
  {
    from: "GITHUB_ID",
    to: "GITHUB_CLIENT_ID",
    note: "GitHub OAuth app client id.",
  },
  {
    from: "GITHUB_SECRET",
    to: "GITHUB_CLIENT_SECRET",
    note: "GitHub OAuth app client secret.",
  },
  {
    from: "GOOGLE_ID",
    to: "GOOGLE_CLIENT_ID",
    note: "Google OAuth client id.",
  },
  {
    from: "GOOGLE_SECRET",
    to: "GOOGLE_CLIENT_SECRET",
    note: "Google OAuth client secret.",
  },
];

/** Quick lookup from a NextAuth var name to its Better Auth replacement. */
export const ENV_LOOKUP: ReadonlyMap<string, EnvMapping> = new Map(
  NEXTAUTH_ENV_MAP.map((m) => [m.from, m]),
);
