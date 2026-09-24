import { NextResponse } from "next/server";
import { AnalyticsService } from "@/services/analytics/AnalyticsService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analytics = new AnalyticsService();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
      ...(searchParams.get("publicationId")
        ? { publicationId: searchParams.get("publicationId") }
        : {}),
      ...(searchParams.get("projectId")
        ? { projectId: searchParams.get("projectId") }
        : {}),
      ...(searchParams.get("channelId")
        ? { channelId: searchParams.get("channelId") }
        : {}),
      ...(searchParams.get("platform")
        ? { platform: searchParams.get("platform")?.toUpperCase() }
        : {}),
    };

    if (searchParams.get("summary") === "1") {
      return NextResponse.json({ summary: await analytics.summarize(filters) });
    }

    return NextResponse.json({ snapshots: await analytics.list(filters) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const snapshot = await analytics.recordSnapshot(body);
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Analytics request failed.";
  return NextResponse.json({ error: message }, { status: 400 });
}
