import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  constantTimeTextEqual,
  createOwnerSessionToken,
  getOwnerAuthConfig,
  getPublicRequestOrigin,
} from "@/lib/owner-auth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = getOwnerAuthConfig(process.env);
  const expected = String(process.env.CLIPFORGE_DEVICE_LOGIN_TOKEN || "").trim();
  const supplied = String(request.nextUrl.searchParams.get("token") || "").trim();

  if (!auth.configured || expected.length < 32 || !constantTimeTextEqual(supplied, expected)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const token = await createOwnerSessionToken({ sessionKey: auth.sessionKey });
  const publicOrigin = getPublicRequestOrigin(request);
  const response = NextResponse.redirect(new URL("/connections", publicOrigin), 303);

  response.cookies.set(OWNER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: publicOrigin.startsWith("https://"),
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
