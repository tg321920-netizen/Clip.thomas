import { NextRequest, NextResponse } from "next/server";
import { MarketingPublishingHub } from "@/services/publishing/MarketingPublishingHub.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const generationId = request.nextUrl.searchParams.get("generationId") || undefined;
    const platform = request.nextUrl.searchParams.get("platform") || undefined;
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const records = await new MarketingPublishingHub().list({ generationId, platform, status });
    return NextResponse.json({ publications: records });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await new MarketingPublishingHub().simulate(body);
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
