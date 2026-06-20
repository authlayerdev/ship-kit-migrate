"use client";

import { authClient } from "@/lib/auth-client";

export function Greeting() {
  // TODO(ship-kit): Clerk useUser() returned { isLoaded, isSignedIn, user }; authClient.useSession() returns { data, isPending, error }. Read data?.user / data?.session and isPending — see the kit's src/components/auth/.
  const { user, isSignedIn } = authClient.useSession();
  if (!isSignedIn) return null;
  return <p>Hello {user?.firstName}</p>;
}

export function SessionId() {
  // TODO(ship-kit): Clerk useAuth() returned { userId, sessionId, isLoaded, isSignedIn, signOut }; authClient.useSession() returns { data, isPending, error }. Read data?.user / data?.session and isPending — see the kit's src/components/auth/.
  const { sessionId } = authClient.useSession();
  return <span>{sessionId}</span>;
}
