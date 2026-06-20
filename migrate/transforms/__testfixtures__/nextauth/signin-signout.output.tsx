"use client";

import { authClient } from "@/lib/auth-client";

export function AuthButtons() {
  // TODO(ship-kit): signIn() arguments differ in Better Auth — see authClient.signIn usage in the kit and MIGRATION.md
  // TODO(ship-kit): signOut() arguments differ in Better Auth — see authClient.signOut usage in the kit and MIGRATION.md
  return (
    <div>
      <button onClick={() => authClient.signIn("github")}>Sign in</button>
      <button onClick={() => authClient.signOut()}>Sign out</button>
    </div>
  );
}
