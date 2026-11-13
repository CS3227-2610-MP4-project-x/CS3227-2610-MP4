import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerConfig } from "@/server/config";
import { resolveE2EExecution } from "@/server/test-support/controls";

export async function proxy(request: NextRequest) {
  if (resolveE2EExecution(process.env)) return NextResponse.next({ request });
  let config: ReturnType<typeof getServerConfig>;
  try {
    config = getServerConfig();
  } catch {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const secure = config.appOrigin.startsWith("https://");
  const supabase = createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure,
          });
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // A refresh failure must not replace normal request handling or expose provider details.
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
