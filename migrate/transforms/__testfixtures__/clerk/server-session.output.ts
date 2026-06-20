import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getUserId() {
  // TODO(ship-kit): Clerk auth() returned { userId, … }; Better Auth returns { user, session } (or null). Use session?.user?.id and session?.session — see the kit's lib/session.ts / requireSession().
  const { userId } = await auth.api.getSession({
    headers: await headers()
  });
  return userId;
}

export async function getProfile() {
  // TODO(ship-kit): Clerk currentUser() returned the full user; Better Auth's session.user has different fields. Read session?.user and map fields — see the kit's lib/session.ts / requireSession().
  const user = await auth.api.getSession({
    headers: await headers()
  });
  return user;
}
