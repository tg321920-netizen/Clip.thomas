import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { PublishingReadinessService } from "@/services/publishing/PublishingReadinessService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const readiness = new PublishingReadinessService();

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params;

  if (!isProjectId(publicationId)) {
    return NextResponse.json(
      { error: "Identificador de publicación inválido." },
      { status: 400 },
    );
  }

  const result = await readiness.check(publicationId);
  if (!result.publication) {
    return NextResponse.json(
      { error: "Publicación no encontrada." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ready: result.ready,
      platform: result.publication.platform,
      reasons: result.reasons,
      requirements: result.requirements,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
