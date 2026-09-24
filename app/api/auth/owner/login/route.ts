import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  constantTimeTextEqual,
  createOwnerSessionToken,
  getOwnerAuthConfig,
  shouldRequireOwnerAuth,
} from "@/lib/owner-auth.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = getOwnerAuthConfig(process.env);
  const wantsJson = Boolean(
    request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json"),
  );

  if (shouldRequireOwnerAuth(process.env) && !auth.configured) {
    return wantsJson
      ? NextResponse.json(
          { error: "OWNER_AUTH_NOT_CONFIGURED" },
          { status: 503 },
        )
      : redirectTo(request, "/setup-required");
  }

  if (!auth.configured) {
    return wantsJson
      ? NextResponse.json({ ok: true, authRequired: false })
      : redirectTo(request, "/");
  }

  const accessKey = await readAccessKey(request, wantsJson);
  if (!constantTimeTextEqual(accessKey, auth.accessKey)) {
    return wantsJson
      ? NextResponse.json(
          { error: "INVALID_OWNER_ACCESS_KEY" },
          { status: 401 },
        )
      : redirectTo(request, "/login?error=1");
  }

  const token = await createOwnerSessionToken({
    sessionKey: auth.sessionKey,
  });
  const response = wantsJson
    ? NextResponse.json({ ok: true })
    : redirectTo(request, "/");

  response.cookies.set(OWNER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      Boolean(process.env.VERCEL_ENV) || request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}

async function readAccessKey(request: NextRequest, wantsJson: boolean) {
  try {
    if (wantsJson) {
      const body = await request.json();
      return String(body?.accessKey || "").trim();
    }
    const form = await request.formData();
    return String(form.get("accessKey") || "").trim();
  } catch {
    return "";
  }
}

function redirectTo(request: NextRequest, destination: string) {
  const url = new URL(destination, request.url);
  return NextResponse.redirect(url, 303);
}
