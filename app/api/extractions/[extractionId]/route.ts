import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ExtractionService } from "@/services/extraction/ExtractionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extractions = new ExtractionService();
type RouteContext = { params: Promise<{ extractionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { extractionId } = await context.params;
  if (!isProjectId(extractionId)) {
    return NextResponse.json({ error: "extractionId inválido." }, { status: 400 });
  }

  const extraction = await extractions.get(extractionId);
  if (!extraction) {
    return NextResponse.json({ error: "Extracción no encontrada." }, { status: 404 });
  }

  return NextResponse.json(
    { extraction },
    { headers: { "Cache-Control": "no-store" } },
  );
}
