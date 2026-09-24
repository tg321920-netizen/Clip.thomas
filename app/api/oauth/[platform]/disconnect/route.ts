import { NextRequest, NextResponse } from "next/server";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  try {
    const { platform } = await context.params;
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    const status = await oauth.getConnectionStatus(channelId);
    if (status.channel.platform !== platform.trim().toUpperCase()) {
      throw new Error("OAuth platform must match the channel platform.");
    }

    const channel = await oauth.disconnect(channelId);
    return NextResponse.json({ channel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OAuth disconnect failed." },
      { status: 400 },
    );
  }
}
