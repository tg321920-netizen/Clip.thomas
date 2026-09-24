import { NextRequest, NextResponse } from "next/server";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  try {
    const { platform } = await context.params;
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    const result = await oauth.createAuthorization(channelId, platform);
    const response = NextResponse.redirect(result.authorizationUrl);

    response.cookies.set(cookieName(result.platform), result.stateCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/oauth/${platform.toLowerCase()}/callback`,
      maxAge: result.cookieMaxAge,
    });
    return response;
  } catch (error) {
    return oauthErrorRedirect(request, error, "start_failed");
  }
}

function cookieName(platform: string) {
  return `clipforge_oauth_${platform.toLowerCase()}_state`;
}

function oauthErrorRedirect(request: NextRequest, error: unknown, code: string) {
  const url = new URL("/autopilot", request.url);
  url.searchParams.set("oauth", code);
  url.searchParams.set(
    "message",
    error instanceof Error ? error.message : "No se pudo iniciar OAuth.",
  );
  return NextResponse.redirect(url);
}
