import { ClerkProvider, SignedIn, SignedOut, UserButton, SignInButton } from "@clerk/nextjs";

export function Layout({ children }: { children: React.ReactNode }) {
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
