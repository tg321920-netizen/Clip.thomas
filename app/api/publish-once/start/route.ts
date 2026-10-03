import { NextRequest, NextResponse } from "next/server";
import { getPublicRequestOrigin } from "@/lib/owner-auth.mjs";
import {
  ensurePublishOnceYouTubeChannel,
  PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
} from "@/services/publishing/PublishOncePodcastService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await ensurePublishOnceYouTubeChannel();
  const origin = getPublicRequestOrigin(request);
  const url = new URL("/api/oauth/youtube/start", origin);
  url.searchParams.set("channelId", PUBLISH_ONCE_YOUTUBE_CHANNEL_ID);
  return NextResponse.redirect(url);
}
