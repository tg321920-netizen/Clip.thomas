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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params;

  if (!isProjectId(publicationId)) {
    return NextResponse.json(
      { error: "Identificador de publicación inválido." },
      { status: 400 },
    );
  }

  const body = await safeJson(request);

  try {
    const publication = await publications.updateDraft(publicationId, {
      ...(Object.hasOwn(body, "title") ? { title: body.title } : {}),
      ...(Object.hasOwn(body, "description")
        ? { description: body.description }
        : {}),
      ...(Object.hasOwn(body, "hashtags") ? { hashtags: body.hashtags } : {}),
      ...(Object.hasOwn(body, "platformSettings")
        ? { platformSettings: body.platformSettings }
        : {}),
    });

    return NextResponse.json({ publication });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo editar la publicación.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
