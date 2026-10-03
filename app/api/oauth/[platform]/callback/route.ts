import { NextRequest, NextResponse } from "next/server";
import { getPublicRequestOrigin } from "@/lib/owner-auth.mjs";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";
import {
  PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
} from "@/services/publishing/PublishOncePodcastService.mjs";
import { queueSmartPublishJob } from "@/services/publishing/SmartPublishJobService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const normalized = platform.trim().toUpperCase();
  const cookie = request.cookies.get(cookieName(normalized))?.value || "";
  const publicOrigin = getPublicRequestOrigin(request);

  try {
    const providerError = request.nextUrl.searchParams.get("error");
    if (providerError) {
      throw new Error(
        request.nextUrl.searchParams.get("error_description") || providerError,
      );
    }

    const result = await oauth.completeAuthorization(normalized, {
      code: request.nextUrl.searchParams.get("code") || "",
      state: request.nextUrl.searchParams.get("state") || "",
      stateCookie: cookie,
    });

    if (
      normalized === "YOUTUBE" &&
      result.channelId === PUBLISH_ONCE_YOUTUBE_CHANNEL_ID &&
      String(process.env.CLIPFORGE_PUBLISH_ONCE_SMART || "").trim().toLowerCase() === "true"
    ) {
      await queueSmartPublishJob(result.channelId);
      const statusUrl = new URL("/publish-once/status", publicOrigin);
      statusUrl.searchParams.set("started", "1");
      const response = NextResponse.redirect(statusUrl, 303);
      response.cookies.delete(cookieName(normalized));
      return response;
    }

    const url = new URL("/connections", publicOrigin);
    url.searchParams.set(
      "oauth",
      result.pageSelectionRequired ? "page_selection_required" : "connected",
    );
    url.searchParams.set("platform", result.platform.toLowerCase());
    url.searchParams.set("channelId", result.channelId);

    const response = NextResponse.redirect(url, 303);
    response.cookies.delete(cookieName(normalized));
    return response;
  } catch (error) {
    const usePublicStatus =
      normalized === "YOUTUBE" &&
      String(process.env.CLIPFORGE_PUBLISH_ONCE_SMART || "").trim().toLowerCase() === "true";
    const url = new URL(usePublicStatus ? "/publish-once/status" : "/connections", publicOrigin);
    url.searchParams.set("oauth", "callback_failed");
    url.searchParams.set("platform", normalized.toLowerCase());
    url.searchParams.set(
      "message",
      error instanceof Error ? error.message : "No se pudo completar OAuth.",
    );
    const response = NextResponse.redirect(url, 303);
    response.cookies.delete(cookieName(normalized));
    return response;
  }
}

function cookieName(platform: string) {
  return `clipforge_oauth_${platform.toLowerCase()}_state`;
}
