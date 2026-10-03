import { NextRequest, NextResponse } from "next/server";
import { getPublicRequestOrigin } from "@/lib/owner-auth.mjs";
import {
  ensurePublishOnceYouTubeChannel,
  PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
} from "@/services/publishing/PublishOncePodcastService.mjs";
import { recordSmartPublishFailure } from "@/services/publishing/SmartPublishJobService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = getPublicRequestOrigin(request);
  try {
    await ensurePublishOnceYouTubeChannel();
    const url = new URL("/api/oauth/youtube/start", origin);
    url.searchParams.set("channelId", PUBLISH_ONCE_YOUTUBE_CHANNEL_ID);
    return NextResponse.redirect(url);
  } catch (error) {
    await recordSmartPublishFailure(error, "START_FAILED");
    return NextResponse.redirect(new URL("/publish-once/status", origin), 303);
  }
}
