export function Layout({ children }: { children: React.ReactNode }) {
  // TODO(ship-kit): <ClerkProvider> has no Better Auth equivalent — Better Auth needs no client provider. Remove this wrapper; the kit wires the auth client in src/lib/auth-client.ts.
  // TODO(ship-kit): <SignedIn> has no drop-in replacement — gate on the session instead: read authClient.useSession() (client) or auth.api.getSession (server) and render conditionally. See the kit's src/components/auth/ and (dashboard) guards.
  // TODO(ship-kit): <UserButton> has no drop-in replacement — use the kit's account menu / SignOutButton in src/components/ and src/components/auth/sign-out-button.tsx.
  // TODO(ship-kit): <SignedOut> has no drop-in replacement — render based on the ABSENCE of a session (see <SignedIn> note). See src/components/auth/.
  // TODO(ship-kit): <SignInButton> has no drop-in replacement — link to the kit's /sign-in route or call authClient.signIn.* from src/components/auth/.
  return (
    <ClerkProvider>
      <header>
        <SignedIn>
          <UserButton />
        </SignedIn>
        <SignedOut>
          <SignInButton />
        </SignedOut>
      </header>
      {children}
    </ClerkProvider>
  );
}
