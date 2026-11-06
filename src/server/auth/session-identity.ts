import "server-only";

import type { AuthPort } from "./auth-port";

export type VerifiedGitHubProfile = Readonly<{
  githubUsername: string;
  avatarUrl: string | null;
}>;

/** Reads display fields only from the verified GitHub identity in the session. */
export async function getVerifiedGitHubProfile(
  client: AuthPort,
): Promise<VerifiedGitHubProfile | null> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;

    const identity = data.user.identities?.find((candidate) => candidate.provider === "github");
    const identityData = identity?.identity_data;
    if (!identityData) return null;

    const githubUsername = [identityData.user_name, identityData.preferred_username, identityData.login]
      .find((value): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,39}$/.test(value));
    if (!githubUsername) return null;

    const avatarValue = identityData.avatar_url ?? identityData.avatarUrl;
    return { githubUsername, avatarUrl: readGitHubAvatarUrl(avatarValue) };
  } catch {
    return null;
  }
}

function readGitHubAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com" &&
      !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
