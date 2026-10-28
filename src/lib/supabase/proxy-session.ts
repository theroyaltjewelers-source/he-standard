import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth", "/api", "/manifest.webmanifest", "/sw.js", "/offline", "/privacy"];

/** Refreshes the auth session cookie on every request and guards private pages. */
export const VERIFIED_USER = "x-standard-user";
export const VERIFIED_EMAIL = "x-standard-email";

export async function updateSession(request: NextRequest) {
  // Never trust identity headers sent by the client.
  request.headers.delete(VERIFIED_USER);
  request.headers.delete(VERIFIED_EMAIL);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet, headers) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v as string));
        },
      },
    },
  );

  // Must run before any response is produced so a refreshed token is written.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  if (signedIn) {
    // Hand the verified identity to Server Components / Actions so they don't
    // repeat the auth round trip. Headers are rebuilt from the (possibly
    // refreshed) request so cookie updates above are preserved.
    request.headers.set(VERIFIED_USER, String(data.claims.sub));
    if (data.claims.email) request.headers.set(VERIFIED_EMAIL, String(data.claims.email));
    const cookiesOut = response.cookies.getAll();
    const extra = [...response.headers.entries()].filter(([k]) => k !== "set-cookie" && !k.startsWith("x-middleware"));
    response = NextResponse.next({ request: { headers: request.headers } });
    cookiesOut.forEach((c) => response.cookies.set(c));
    extra.forEach(([k, v]) => response.headers.set(k, v));
  }
  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (signedIn && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
