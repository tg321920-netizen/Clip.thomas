import { NextRequest, NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "@/lib/owner-auth.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure:
      Boolean(process.env.VERCEL_ENV) || request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}
