export const config = {
  secret: process.env.CLERK_SECRET_KEY,
  publishable: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  unrelated: process.env.SOME_OTHER_VAR,
};
