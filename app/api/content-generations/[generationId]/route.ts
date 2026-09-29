import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ContentGenerationService } from "@/services/content-generation/ContentGenerationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = new ContentGenerationService();
type RouteContext = { params: Promise<{ generationId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { generationId } = await context.params;
  if (!isProjectId(generationId)) {
    return NextResponse.json({ error: "generationId inválido." }, { status: 400 });
  }

  const generation = await content.get(generationId);
  if (!generation) {
    return NextResponse.json({ error: "Contenido generado no encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    { generation },
    { headers: { "Cache-Control": "no-store" } },
  );
}
