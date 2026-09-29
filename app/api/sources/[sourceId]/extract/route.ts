import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ExtractionService } from "@/services/extraction/ExtractionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extractions = new ExtractionService();
type RouteContext = { params: Promise<{ sourceId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { sourceId } = await context.params;
  if (!isProjectId(sourceId)) {
    return NextResponse.json({ error: "sourceId inválido." }, { status: 400 });
  }

  try {
    const extraction = await extractions.extract(sourceId);
    return NextResponse.json({ extraction }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo extraer la fuente.";
    const status = /not found/i.test(message) ? 404 : 422;
    const extractionId =
      error && typeof error === "object" && "extractionId" in error
        ? String((error as { extractionId?: unknown }).extractionId || "")
        : "";
    return NextResponse.json(
      { error: message, ...(extractionId ? { extractionId } : {}) },
      { status },
    );
  }
}
