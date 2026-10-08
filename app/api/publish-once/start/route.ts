import { NextRequest, NextResponse } from "next/server";
import { getPublicRequestOrigin } from "@/lib/owner-auth.mjs";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";
import {
  ensurePublishOnceYouTubeChannel,
  PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
} from "@/services/publishing/PublishOncePodcastService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function GET(request: NextRequest) {
  const origin = getPublicRequestOrigin(request);
  try {
    await ensurePublishOnceYouTubeChannel();

    const existing = await oauth.verifyYouTubeConnection(
      PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
    ).catch(() => null);
    if (existing?.valid) {
      return NextResponse.redirect(
        new URL("/publish-once/status?restored=1", origin),
        303,
      );
    }

    const url = new URL("/api/oauth/youtube/start", origin);
    url.searchParams.set("channelId", PUBLISH_ONCE_YOUTUBE_CHANNEL_ID);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/publish-once/status?oauth=start_failed", origin), 303);
  }
}
