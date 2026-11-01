import "server-only";

import type { PeopleRepository } from "@/server/repositories/people-repository";
import type { AuthPort, AuthUser } from "./auth-port";

export class AuthenticationError extends Error {
  constructor() {
    super("GitHub authentication could not be completed.");
    this.name = "AuthenticationError";
  }
}

function getVerifiedGitHubIdentity(user: AuthUser) {
  const identity = user.identities?.find((candidate) => candidate.provider === "github");
  const identityData = identity?.identity_data;
  if (!identity || !identityData) {
    throw new AuthenticationError();
  }

  const githubUserId = identity.provider_id;
  const githubUsername = [identityData.user_name, identityData.preferred_username, identityData.login]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const normalizedId = String(githubUserId ?? "");

  if (
    !/^[1-9]\d*$/.test(normalizedId) ||
    typeof user.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id) ||
    !githubUsername || !/^[A-Za-z0-9-]{1,39}$/.test(githubUsername)
  ) {
    throw new AuthenticationError();
  }

  return { authUserId: user.id, githubUserId: normalizedId, githubUsername };
}

export class AuthService {
  constructor(
    private readonly appOrigin: string,
    private readonly peopleRepository: PeopleRepository,
  ) {}

  async startGitHubSignIn(client: AuthPort, supabaseUrl: string): Promise<string> {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${this.appOrigin}/api/v1/auth/callback` },
    });
    if (error || !data.url || !isSupabaseAuthorizationUrl(data.url, supabaseUrl)) {
      throw new AuthenticationError();
    }
    return data.url;
  }

  async completeGitHubSignIn(client: AuthPort, code: string): Promise<void> {
    let sessionEstablished = false;
    try {
      const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        throw new AuthenticationError();
      }
      sessionEstablished = true;

      // Re-read the user from Supabase Auth after the code exchange. Identity data in
      // callback query parameters and editable user_metadata are never authoritative.
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        throw new AuthenticationError();
      }

      const identity = getVerifiedGitHubIdentity(data.user);
      await this.peopleRepository.upsertVerifiedGitHubIdentity(identity);
    } catch {
      // Remove any session cookies established by code exchange before the callback
      // redirects to its safe failure destination.
      if (sessionEstablished) {
        try {
          await client.auth.signOut({ scope: "local" });
        } catch {
          // The route returns a generic failure either way; never expose auth details.
        }
      }
      throw new AuthenticationError();
    }
  }

  async signOut(client: AuthPort): Promise<void> {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      throw new AuthenticationError();
    }
  }
}

function isSupabaseAuthorizationUrl(value: string, supabaseUrl: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(supabaseUrl).origin &&
      url.pathname === "/auth/v1/authorize" &&
      url.searchParams.get("provider") === "github";
  } catch {
    return false;
  }
}
