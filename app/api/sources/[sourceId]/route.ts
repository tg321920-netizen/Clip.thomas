import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { SourceService } from "@/services/sources/SourceService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sources = new SourceService();
type RouteContext = { params: Promise<{ sourceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { sourceId } = await context.params;
  if (!isProjectId(sourceId)) {
    return NextResponse.json({ error: "sourceId inválido." }, { status: 400 });
  }

  const source = await sources.get(sourceId);
  if (!source) {
    return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
  }

  return NextResponse.json(
    { source },
    { headers: { "Cache-Control": "no-store" } },
  );
}
