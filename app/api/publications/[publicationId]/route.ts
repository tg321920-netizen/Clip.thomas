import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publications = new PublicationService();

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

  const publication = await publications.get(publicationId);
  if (!publication) {
    return NextResponse.json(
      { error: "Publicación no encontrada." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { publication },
    { headers: { "Cache-Control": "no-store" } },
  );
}
