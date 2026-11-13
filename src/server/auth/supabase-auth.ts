import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ServerConfig } from "@/server/config";
import type { AuthIdentity, AuthPort, AuthUser } from "./auth-port";
import { resolveE2EExecution } from "@/server/test-support/controls";
import { createSyntheticAuthPort, E2E_SESSION_COOKIE } from "@/server/test-support/synthetic-session";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIdentity(value: unknown): AuthIdentity | null {
  if (!isRecord(value)) return null;

  const provider = typeof value.provider === "string" ? value.provider : undefined;
  const hasCanonicalProviderId = Object.prototype.hasOwnProperty.call(value, "provider_id");
  const providerId = hasCanonicalProviderId
    ? value.provider_id
    : provider === "github"
      ? value.id
      : undefined;
  const identityData = isRecord(value.identity_data) ? value.identity_data : null;
  return {
    provider,
    provider_id: providerId,
    identity_data: identityData,
  };
}

function readUser(value: unknown): AuthUser | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const identities = Array.isArray(value.identities)
    ? value.identities.map(readIdentity).filter((identity) => identity !== null)
    : null;
  return { id: value.id, identities };
}

export async function createRequestSupabaseClient(
  config: Pick<ServerConfig, "appOrigin" | "supabasePublishableKey" | "supabaseUrl">,
): Promise<AuthPort> {
  const cookieStore = await cookies();
  if (resolveE2EExecution(process.env)) {
    return createSyntheticAuthPort(
      cookieStore.get(E2E_SESSION_COOKIE)?.value,
      async () => { cookieStore.delete(E2E_SESSION_COOKIE); },
    );
  }
  const secure = config.appOrigin.startsWith("https://");
  const supabase = createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure,
          });
        }
      },
    },
  });

  return {
    auth: {
      async signInWithOAuth(input) {
        const { data, error } = await supabase.auth.signInWithOAuth(input);
        return { data: { url: data.url }, error };
      },
      async exchangeCodeForSession(code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        return { error };
      },
      async getUser() {
        const { data, error } = await supabase.auth.getUser();
        return { data: { user: readUser(data.user) }, error };
      },
      async signOut(options) {
        const { error } = await supabase.auth.signOut(options);
        return { error };
      },
    },
  };
}
