import { getServerSession } from "next-auth/next";

export async function getUser() {
  const session = await getServerSession();
  return session?.user ?? null;
}
