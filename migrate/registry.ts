/**
 * The registry of buyer-runnable transforms.
 *
 * Add a new transform here (and a fixture corpus under
 * `transforms/__testfixtures__/<name>/`) to make it available to the CLI, the
 * runner, and the test harness. This single source of truth keeps `--help`, the
 * `--transform` validation, and the corpus discovery in sync.
 */
import identity from "./transforms/identity";
import nextauth from "./transforms/nextauth";
import clerk from "./transforms/clerk";
import type { TransformEntry } from "./types";

export const TRANSFORMS: readonly TransformEntry[] = [
  {
    name: "nextauth",
    summary:
      "NextAuth (next-auth) → Better Auth: imports, session call-sites, env vars + config-scaffold TODOs",
    transform: nextauth,
  },
  {
    name: "clerk",
    summary:
      "Clerk (@clerk/nextjs) → Better Auth: imports, auth()/currentUser()/useUser()/useAuth() call-sites, env vars + component/middleware TODOs",
    transform: clerk,
  },
  {
    name: "identity",
    summary:
      "No-op round-trip transform (proves the harness/CLI; useful for smoke tests)",
    transform: identity,
  },
];

/** Look up a transform by its CLI name; `undefined` if unknown. */
export function getTransform(name: string): TransformEntry | undefined {
  return TRANSFORMS.find((t) => t.name === name);
}

/** All registered transform names (for `--help` and validation messages). */
export function transformNames(): string[] {
  return TRANSFORMS.map((t) => t.name);
}
