import { NextRequest, NextResponse } from "next/server";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oauth = new OAuthConnectionService();

export async function GET(request: NextRequest) {
  try {
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    const pages = await oauth.listFacebookPages(channelId);
    return NextResponse.json({ pages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    const body = await request.json();
    const result = await oauth.selectFacebookPage(channelId, body?.pageId);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Facebook Page selection failed." },
    { status: 400 },
  );
}
