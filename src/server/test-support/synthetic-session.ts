import "server-only";

import { cookies } from "next/headers";
import type { AuthIdentity, AuthPort, AuthUser } from "@/server/auth/auth-port";
import { signE2ESession, verifyE2ESession, E2E_IDENTITIES, type SyntheticIdentity, type SyntheticSessionClaims, type SyntheticSessionPayload } from "./session-token";

export const E2E_SESSION_COOKIE = "mp4_e2e_session";
const MAX_SESSION_AGE_SECONDS = 60 * 60 * 8;
export { E2E_IDENTITIES };
export type { SyntheticIdentity, SyntheticSessionClaims };
type SessionPayload = SyntheticSessionPayload;

function key(): string {
  const value = process.env.E2E_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("E2E_SESSION_SECRET must contain at least 32 characters.");
  return value;
}

export function issueSyntheticSession(claims: SyntheticSessionClaims, now = Date.now()): string {
  return signE2ESession(claims, key(), now);
}

export async function readSyntheticSessionClaims(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifyE2ESession(store.get(E2E_SESSION_COOKIE)?.value, key());
}

export function createSyntheticAuthPort(token: string | undefined, clearSession: () => Promise<void>): AuthPort {
  const session = verifyE2ESession(token, key());
  const identity: AuthIdentity | null = session ? {
    provider: "github",
    provider_id: session.githubId,
    identity_data: { user_name: session.githubUsername, preferred_username: session.githubUsername },
  } : null;
  const user: AuthUser | null = session ? { id: session.id, identities: identity ? [identity] : [] } : null;
  return { auth: {
    async signInWithOAuth() { return { data: { url: null }, error: new Error("Synthetic sessions do not support OAuth.") }; },
    async exchangeCodeForSession() { return { error: new Error("Synthetic sessions do not support OAuth.") }; },
    async getUser() { return { data: { user }, error: null }; },
    async signOut() { await clearSession(); return { error: null }; },
  } };
}
