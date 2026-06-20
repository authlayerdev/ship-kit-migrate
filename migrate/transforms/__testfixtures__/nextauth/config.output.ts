// TODO(ship-kit): These NextAuth options don't map 1:1 to Better Auth — port providers/callbacks/adapter into betterAuth(...) in lib/auth.ts. This object is no longer used after migration.
export const authOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  callbacks: {
    async session({ session, token }) {
      return session;
    },
  },
};

// TODO(ship-kit): Replace this NextAuth(...) config with betterAuth(...) — providers, callbacks and the adapter are configured differently. Use the kit's lib/auth.ts as the template.
export default NextAuth(authOptions);
