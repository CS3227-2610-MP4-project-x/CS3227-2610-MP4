export type AuthIdentity = Readonly<{
  provider?: string;
  provider_id?: unknown;
  identity_data?: Record<string, unknown> | null;
}>;

export type AuthUser = Readonly<{
  id: string;
  identities?: AuthIdentity[] | null;
}>;

export type AuthPort = Readonly<{
  auth: Readonly<{
    signInWithOAuth(input: {
      provider: "github";
      options: { redirectTo: string };
    }): Promise<{ data: { url: string | null }; error: unknown | null }>;
    exchangeCodeForSession(code: string): Promise<{ error: unknown | null }>;
    getUser(): Promise<{ data: { user: AuthUser | null }; error: unknown | null }>;
    signOut(options: { scope: "local" }): Promise<{ error: unknown | null }>;
  }>;
}>;
