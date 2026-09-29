import { NextRequest, NextResponse } from "next/server";
import { MarketingEditService } from "@/services/media-processing/MarketingEditService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const generationId = request.nextUrl.searchParams.get("generationId") || undefined;
    const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const records = await new MarketingEditService().list({ generationId, projectId, status });
    return NextResponse.json({ edits: records });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const edit = await new MarketingEditService().prepare(body);
    return NextResponse.json({ edit }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
