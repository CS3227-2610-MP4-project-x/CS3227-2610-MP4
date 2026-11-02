import { NextResponse, type NextRequest } from "next/server";
import { createRequestSupabaseClient } from "@/server/auth/supabase-auth";
import { getServerComposition } from "@/server/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let composition: ReturnType<typeof getServerComposition>;
  try {
    composition = getServerComposition();
  } catch {
    return NextResponse.json(
      { error: { code: "AUTHENTICATION_FAILED", message: "Sign-out could not be completed." } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { authService, config } = composition;
  if (request.headers.get("origin") !== config.appOrigin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Request origin is not allowed." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const client = await createRequestSupabaseClient(config);
    await authService.signOut(client);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: { code: "AUTHENTICATION_FAILED", message: "Sign-out could not be completed." } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
