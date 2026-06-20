/**
 * Clerk → Better Auth environment-variable mapping.
 *
 * This is the single source of truth for how common Clerk env vars map onto the
 * Better Auth / Ship Kit names. It is:
 *   1. applied in code by the `clerk` transform (rewriting `process.env.X`
 *      member accesses), and
 *   2. documented in MIGRATION.md as the `.env` rename table (the transform
 *      can't edit `.env` files — they aren't JavaScript).
 *
 * Honesty note: Clerk and Better Auth are NOT drop-in equivalents at the env
 * level. Clerk's publishable/secret keys identify a hosted Clerk instance; Better
 * Auth has no equivalent SaaS account — it just needs a signing secret and your
 * app URL. So these mappings are "the var you set instead", each carrying a note
 * that explains the difference. They are deliberately conservative: a Clerk var
 * with no meaningful Better Auth counterpart (e.g. the redirect-URL vars, which
 * become routing config in the kit, not env) is documented in MIGRATION.md as
 * "delete / no equivalent" rather than mapped to a misleading name.
 */
export interface EnvMapping {
  readonly from: string;
  readonly to: string;
  readonly note: string;
}

export const CLERK_ENV_MAP: readonly EnvMapping[] = [
  {
    from: "CLERK_SECRET_KEY",
    to: "BETTER_AUTH_SECRET",
    note: "NOT a 1:1 swap. Clerk's secret key authenticates your app to Clerk's API; Better Auth's secret only signs sessions/tokens. Generate a fresh 32+ char value (pnpm dlx @better-auth/cli secret) — do NOT reuse the Clerk key.",
  },
  {
    from: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    to: "NEXT_PUBLIC_BETTER_AUTH_URL",
    note: "Clerk's publishable key has no Better Auth equivalent (there is no hosted Clerk instance to point at). The closest client-side env the kit uses is the app's base URL. Review this rename by hand — you most likely DELETE the publishable key and set NEXT_PUBLIC_BETTER_AUTH_URL to your app URL.",
  },
];

/** Quick lookup from a Clerk var name to its Better Auth replacement. */
export const ENV_LOOKUP: ReadonlyMap<string, EnvMapping> = new Map(
  CLERK_ENV_MAP.map((m) => [m.from, m]),
);

/**
 * Clerk env vars that have NO meaningful Better Auth counterpart and should be
 * removed, with the kit's replacement mechanism. Documented in MIGRATION.md; not
 * rewritten in code (renaming them to something would be misleading).
 */
export interface EnvRemoval {
  readonly name: string;
  readonly replacement: string;
}

export const CLERK_ENV_REMOVALS: readonly EnvRemoval[] = [
  {
    name: "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    replacement:
      "Routing config, not env. The kit's sign-in route is /sign-in (src/app/(auth)/sign-in). Delete this var.",
  },
  {
    name: "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    replacement:
      "Routing config, not env. The kit's sign-up route is /sign-up. Delete this var.",
  },
  {
    name: "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
    replacement:
      "Post-auth redirect is handled by the kit's callbackURL / safeRedirectPath flow (?redirectTo). Delete this var.",
  },
  {
    name: "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
    replacement:
      "Post-auth redirect is handled by the kit's callbackURL / safeRedirectPath flow (?redirectTo). Delete this var.",
  },
];
