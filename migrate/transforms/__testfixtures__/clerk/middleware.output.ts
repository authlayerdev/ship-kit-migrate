// TODO(ship-kit): clerkMiddleware() has no Better Auth equivalent. Replace this with the kit's edge cookie-check in src/proxy.ts plus an authoritative server-side requireSession() in your protected routes/layouts. See MIGRATION.md (middleware).
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
