import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { ServerComposition } from "@/server/composition";
import { resolveProjectAccess, type AccessResult } from "./request-access";
import { getVerifiedGitHubProfile, type VerifiedGitHubProfile } from "./session-identity";
import { createRequestSupabaseClient } from "./supabase-auth";
import type { AuthPort } from "./auth-port";
import { isUuid } from "./uuid";

// design.md "Board, Detail and Review Queue Decisions (4.4)" B6, B10: maps resolveProjectAccess
// to Server Component outcomes. 401 redirects to /sign-in and 404 is the safe not-found result.
// A role refusal (403) is not decided here: the read services refuse and the page shows an inline
// unavailable view. The experimental forbidden() and unauthorized() interrupts are not used.

// React's cache deduplicates within one server render pass only, so the project layout and its
// page share one session and membership lookup per request. Every page still calls
// requireProjectPageAccess itself (B2); nothing is kept across requests.
const resolveProjectAccessOncePerRequest = cache(
  (composition: ServerComposition, projectId: string) => resolveProjectAccess(composition, projectId),
);

/** Shows the safe not-found result for a path ID that is not a UUID. */
export function requirePagePathId(value: string): void {
  if (!isUuid(value)) notFound();
}

/** The signed-in member's person and role in the project, or a redirect, not-found or safe error. */
export async function requireProjectPageAccess(
  composition: ServerComposition,
  projectId: string,
): Promise<AccessResult> {
  requirePagePathId(projectId);
  const access = await resolveProjectAccessOncePerRequest(composition, projectId);
  if (!(access instanceof Response)) return access;
  if (access.status === 401) redirect("/sign-in");
  if (access.status === 404) notFound();
  throw new Error("Project access could not be checked.");
}

export type WorkspaceSession = Readonly<{ authUserId: string; profile: VerifiedGitHubProfile }>;

/**
 * The workspace page's session (`/`): the verified GitHub profile and the Supabase Auth user ID
 * from one getUser call. Any missing or failed session redirects to /sign-in.
 */
export async function requireWorkspaceSession(config: ServerComposition["config"]): Promise<WorkspaceSession> {
  let session: WorkspaceSession | null = null;
  try {
    const client = await createRequestSupabaseClient(config);
    const result = await client.auth.getUser();
    // The profile is read from the same getUser result rather than a second provider call.
    const profile = await getVerifiedGitHubProfile(replayGetUser(client, result));
    const authUserId = result.data.user?.id;
    if (profile && authUserId) session = { authUserId, profile };
  } catch { /* An unreadable session is treated as signed out. */ }
  if (!session) redirect("/sign-in");
  return session;
}

function replayGetUser(client: AuthPort, result: Awaited<ReturnType<AuthPort["auth"]["getUser"]>>): AuthPort {
  return {
    auth: {
      signInWithOAuth: (input) => client.auth.signInWithOAuth(input),
      exchangeCodeForSession: (code) => client.auth.exchangeCodeForSession(code),
      getUser: async () => result,
      signOut: (options) => client.auth.signOut(options),
    },
  };
}
