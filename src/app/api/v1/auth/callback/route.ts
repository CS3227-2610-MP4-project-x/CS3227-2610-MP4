import { NextResponse, type NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let composition: ReturnType<typeof getServerComposition>;
  try {
    composition = getServerComposition();
  } catch {
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: "/sign-in?auth=failed",
        "Cache-Control": "no-store",
      },
    });
  }

  const { authService, config } = composition;
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return callbackFailure(config.appOrigin);

  try {
    const client = await createRequestSupabaseClient(config);
    await authService.completeGitHubSignIn(client, code);
    const response = NextResponse.redirect(config.appOrigin, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return callbackFailure(config.appOrigin);
  }
}

function callbackFailure(appOrigin: string) {
  const response = NextResponse.redirect(new URL("/sign-in?auth=failed", appOrigin), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
