import { NextResponse, type NextRequest } from "next/server";
import { AuthenticationError } from "@/server/auth/auth-service";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const { authService, config } = getServerComposition();
    const client = await createRequestSupabaseClient(config);
    const providerUrl = await authService.startGitHubSignIn(client, config.supabaseUrl);
    const response = NextResponse.redirect(providerUrl);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const status = error instanceof AuthenticationError ? 502 : 500;
    const response = NextResponse.json(
      { error: { code: "AUTHENTICATION_FAILED", message: "Sign-in could not be started." } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
    return response;
  }
}
