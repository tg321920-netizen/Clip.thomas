import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";
import { PublishingReadinessService } from "@/services/publishing/PublishingReadinessService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new JobStore();
const publications = new PublicationService();
const readiness = new PublishingReadinessService({ publications });

export async function POST(
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

  if (publication.status !== "SCHEDULED") {
    return NextResponse.json(
      { error: `La publicación debe estar SCHEDULED, estado actual: ${publication.status}.` },
      { status: 409 },
    );
  }

  const scheduledAt = Date.parse(publication.scheduledAt || "");
  if (!Number.isFinite(scheduledAt) || scheduledAt > Date.now()) {
    return NextResponse.json(
      { error: "La publicación todavía no está vencida para envío." },
      { status: 409 },
    );
  }

  const state = await readiness.check(publicationId);
  if (!state.ready) {
    return NextResponse.json(
      {
        error: "La publicación no está lista para enviarse al proveedor.",
        reasons: state.reasons,
      },
      { status: 409 },
    );
  }

  const job = await jobs.enqueuePublish(
    publication.projectId,
    publication.id,
    { publicationId: publication.id },
  );

  return NextResponse.json({ publication, job }, { status: 202 });
}
