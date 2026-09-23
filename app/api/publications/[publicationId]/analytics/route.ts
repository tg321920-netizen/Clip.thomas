import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import { AnalyticsCollectorService } from "@/services/analytics/AnalyticsCollectorService.mjs";
import { AnalyticsService } from "@/services/analytics/AnalyticsService.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new JobStore();
const analytics = new AnalyticsService();
const publications = new PublicationService();
const collector = new AnalyticsCollectorService({ analytics, publications });

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

  const snapshots = await analytics.list({ publicationId });
  const job = await jobs.getAnalyticsJob(publication.projectId, publicationId);

  return NextResponse.json(
    {
      supported: collector.supportsPlatform(publication.platform),
      snapshots,
      latest: snapshots.at(-1) || null,
      job,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

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
  if (publication.status !== "PUBLISHED" || !publication.externalPostId) {
    return NextResponse.json(
      { error: "La publicación debe estar publicada antes de consultar métricas." },
      { status: 409 },
    );
  }
  if (!collector.supportsPlatform(publication.platform)) {
    return NextResponse.json(
      {
        error: "Este proveedor todavía no expone métricas mediante el adapter configurado.",
        platform: publication.platform,
      },
      { status: 422 },
    );
  }

  const job = await jobs.enqueueAnalytics(
    publication.projectId,
    publication.id,
    { publicationId: publication.id },
    { restartCompleted: true },
  );

  return NextResponse.json({ job }, { status: 202 });
}
