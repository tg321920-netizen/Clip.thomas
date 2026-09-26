import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_SESSION_COOKIE,
  getOwnerAuthConfig,
  getPublicRequestOrigin,
  shouldRequireOwnerAuth,
  verifyOwnerSessionToken,
} from "./lib/owner-auth.mjs";

const PUBLIC_PATHS = new Set([
  "/login",
  "/setup-required",
  "/api/auth/owner/login",
]);

const PUBLIC_HEALTH_PATH = "/api/health";

export default async function proxy(request: NextRequest) {
  if (!shouldRequireOwnerAuth(process.env)) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (pathname === PUBLIC_HEALTH_PATH) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  const auth = getOwnerAuthConfig(process.env);

  if (!auth.configured) {
    if (pathname === "/setup-required") {
      return NextResponse.next();
    }

    if (isApi) {
      return NextResponse.json(
        {
          error: "OWNER_AUTH_NOT_CONFIGURED",
          message:
            "ClipForge owner access is required on hosted deployments but its server-side secrets are not configured.",
        },
        { status: 503 },
      );
    }

    return redirectTo(request, "/setup-required");
  }

  if (pathname === "/setup-required") {
    return redirectTo(request, "/");
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login") {
      const token = request.cookies.get(OWNER_SESSION_COOKIE)?.value || "";
      const valid = await verifyOwnerSessionToken(token, {
        sessionKey: auth.sessionKey,
      });
      if (valid) {
        return redirectTo(request, "/");
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(OWNER_SESSION_COOKIE)?.value || "";
  const valid = await verifyOwnerSessionToken(token, {
    sessionKey: auth.sessionKey,
  });

  if (valid) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Owner session is required." },
      { status: 401 },
    );
  }

  return redirectTo(request, "/login");
}

function redirectTo(request: NextRequest, destination: string) {
  const url = new URL(destination, getPublicRequestOrigin(request));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
