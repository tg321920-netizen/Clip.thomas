import { NextResponse } from "next/server";
import { PerformanceAnalyzer } from "@/services/analytics/PerformanceAnalyzer.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analyzer = new PerformanceAnalyzer();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
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

    return NextResponse.json({ report: await analyzer.analyze(filters) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Performance analysis failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
