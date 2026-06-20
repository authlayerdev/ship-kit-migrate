"use client";

import { signIn, signOut } from "next-auth/react";

export function AuthButtons() {
  return (
    <div>
      <button onClick={() => signIn("github")}>Sign in</button>
      <button onClick={() => signOut()}>Sign out</button>
    </div>
  );
}
