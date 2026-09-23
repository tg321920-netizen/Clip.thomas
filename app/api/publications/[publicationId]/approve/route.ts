import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publications = new PublicationService();

export async function POST(
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
    const publication = await publications.approve(publicationId, {
      consent: body.consent === true,
      ...(Object.hasOwn(body, "platformSettings")
        ? { platformSettings: body.platformSettings }
        : {}),
    });
    return NextResponse.json({ publication });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo aprobar la publicación.";
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
