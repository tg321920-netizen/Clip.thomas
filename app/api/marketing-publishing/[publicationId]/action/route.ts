import { NextRequest, NextResponse } from "next/server";
import { MarketingPublishingHub } from "@/services/publishing/MarketingPublishingHub.mjs";

type Context = { params: Promise<{ publicationId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: Context) {
  try {
    const { publicationId } = await context.params;
    const body = await request.json();
    const action = String(body?.action || "").trim().toUpperCase();
    const hub = new MarketingPublishingHub();
    if (action === "REQUEST_APPROVAL") {
      const result = await hub.requestPublicationApproval(publicationId);
      return NextResponse.json(result);
    }
    if (action === "HANDOFF_AUTHORIZED") {
      const result = await hub.handoffToAuthorizedPublishing(publicationId, { channelId: body?.channelId });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
