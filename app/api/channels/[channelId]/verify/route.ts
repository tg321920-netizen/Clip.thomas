import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { OAuthConnectionService } from "@/services/oauth/OAuthConnectionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) return NextResponse.json({ error: "Invalid channel ID." }, { status: 400 });
  try {
    return NextResponse.json(await new OAuthConnectionService().verifyYouTubeConnection(channelId));
  } catch (error) {
    return NextResponse.json({ valid: false, error: error instanceof Error ? error.message : "YouTube verification failed." }, { status: 422 });
  }
}
