"use client";

import { useSession } from "next-auth/react";

export function Greeting() {
  const { data: session } = useSession();
  return <p>Hello {session?.user?.name}</p>;
}
