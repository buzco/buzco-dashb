import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // The standalone stall links (/s/<token>/…) are handed to helpers who have no
  // dashboard account, so they must skip the login redirect. They are guarded
  // instead by the unguessable token in the path, checked in lib/market/link.ts
  // — the redirect below would otherwise bounce them to a login they can't pass.
  if (request.nextUrl.pathname.startsWith("/s/")) {
    return supabaseResponse;
  }

  // Shopify's webhook callback has no session and never will. Redirecting it to
  // /login would answer 3xx, which Shopify counts as a delivery failure and
  // retries for two days. The route authenticates itself instead, by verifying
  // Shopify's HMAC over the raw request body.
  if (request.nextUrl.pathname.startsWith("/api/shopify/webhook")) {
    return supabaseResponse;
  }

  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
