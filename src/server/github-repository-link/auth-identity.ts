import "server-only";

import type { AuthUser } from "@/server/auth/auth-port";
import { linkFailure } from "./errors";
import type { VerifiedGitHubIdentity } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

export function verifiedGitHubIdentity(user: AuthUser | null): VerifiedGitHubIdentity {
  if (!user || !UUID.test(user.id)) linkFailure(401);
  const identity = user.identities?.find((candidate) => candidate.provider === "github");
  const githubUserId = String(identity?.provider_id ?? "");
  if (!POSITIVE_DECIMAL.test(githubUserId)) linkFailure(403);
  return { authUserId: user.id, githubUserId };
}
