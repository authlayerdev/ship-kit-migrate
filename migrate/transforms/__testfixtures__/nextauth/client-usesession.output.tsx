"use client";

import { authClient } from "@/lib/auth-client";

export function Greeting() {
  const { data: session } = authClient.useSession();
  return <p>Hello {session?.user?.name}</p>;
}
