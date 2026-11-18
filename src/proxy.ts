import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const publicPaths = [
    "/login",
    "/register",
    "/auth/callback",
    "/api/supabase-check",
  ];

  const isPublicPath = publicPaths.includes(pathname);

  function redirectWithCookies(url: URL) {
    const redirectResponse = NextResponse.redirect(url);

    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });

    return redirectResponse;
  }

  // Signed-out visitors cannot access protected routes.
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);

    return redirectWithCookies(loginUrl);
  }

  // Signed-in visitors should proceed through onboarding.
  if (user && (pathname === "/login" || pathname === "/register")) {
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = "/setup-organization";
    setupUrl.search = "";

    return redirectWithCookies(setupUrl);
  }

  // Organization setup performs its own membership check.
  if (user && pathname === "/setup-organization") {
    return response;
  }

  // Require organization membership for protected workspace routes.
  if (user && !isPublicPath) {
    const { data: memberships, error } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1);

    if (error || !memberships || memberships.length === 0) {
      const setupUrl = request.nextUrl.clone();
      setupUrl.pathname = "/setup-organization";
      setupUrl.search = "";

      return redirectWithCookies(setupUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};


