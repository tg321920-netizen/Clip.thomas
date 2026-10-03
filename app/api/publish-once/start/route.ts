import { NextRequest, NextResponse } from "next/server";
import { getPublicRequestOrigin } from "@/lib/owner-auth.mjs";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";
import {
  ensurePublishOnceYouTubeChannel,
  PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
} from "@/services/publishing/PublishOncePodcastService.mjs";
import {
  queueSmartPublishJob,
  recordSmartPublishFailure,
} from "@/services/publishing/SmartPublishJobService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function GET(request: NextRequest) {
  const origin = getPublicRequestOrigin(request);
  try {
    await ensurePublishOnceYouTubeChannel();

    const existing = await oauth.getValidCredentials(
      PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
    );
    if (existing?.accessToken) {
      await queueSmartPublishJob(PUBLISH_ONCE_YOUTUBE_CHANNEL_ID);
      return NextResponse.redirect(
        new URL("/publish-once/status?restored=1", origin),
        303,
      );
    }

    const url = new URL("/api/oauth/youtube/start", origin);
    url.searchParams.set("channelId", PUBLISH_ONCE_YOUTUBE_CHANNEL_ID);
    return NextResponse.redirect(url);
  } catch (error) {
    await recordSmartPublishFailure(error, "START_FAILED");
    return NextResponse.redirect(new URL("/publish-once/status", origin), 303);
  }
}
