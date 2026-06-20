"use client";

import { useUser, useAuth } from "@clerk/nextjs";

export function Greeting() {
  const { user, isSignedIn } = useUser();
  if (!isSignedIn) return null;
  return <p>Hello {user?.firstName}</p>;
}

export function SessionId() {
  const { sessionId } = useAuth();
  return <span>{sessionId}</span>;
}
