import { NextResponse, type NextRequest } from "next/server";
import { AuthenticationError } from "@/server/auth/auth-service";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";
import { logServerFailure } from "@/server/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  let composition: ReturnType<typeof getServerComposition>;
  try {
    composition = getServerComposition();
  } catch {
    // getServerComposition has already logged the configuration failure.
    return signInFailure(500);
  }

  const { authService, config } = composition;
  try {
    const client = await createRequestSupabaseClient(config);
    const providerUrl = await authService.startGitHubSignIn(client, config.supabaseUrl);
    const response = NextResponse.redirect(providerUrl);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logServerFailure("GitHub sign-in start", error);
    return signInFailure(error instanceof AuthenticationError ? 502 : 500);
  }
}

function signInFailure(status: 500 | 502) {
  return NextResponse.json(
    { error: { code: "AUTHENTICATION_FAILED", message: "Sign-in could not be started." } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
