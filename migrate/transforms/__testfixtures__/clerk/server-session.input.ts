import { auth, currentUser } from "@clerk/nextjs/server";

export async function getUserId() {
  const { userId } = await auth();
  return userId;
}

export async function getProfile() {
  const user = await currentUser();
  return user;
}
