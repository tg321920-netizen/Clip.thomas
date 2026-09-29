import { NextRequest, NextResponse } from "next/server";
import { MarketingMemoryService } from "@/services/marketing-memory/MarketingMemoryService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
    const service = new MarketingMemoryService();
    const summary = await service.summarize({ projectId });
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const service = new MarketingMemoryService();
    if (body?.action === "CAPTURE_PERFORMANCE") {
      const result = await service.capturePerformance({ ...(body?.projectId ? { projectId: body.projectId } : {}) });
      return NextResponse.json(result);
    }
    if (body?.generationId) {
      const result = await service.captureGeneration(body.generationId);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "generationId or CAPTURE_PERFORMANCE action is required." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
