import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { AutopilotService } from "@/services/autopilot/AutopilotService.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";
import { SchedulerService } from "@/services/scheduler/SchedulerService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publications = new PublicationService();
const scheduler = new SchedulerService({ publications });
const autopilot = new AutopilotService({ publications, scheduler });

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
    if (typeof body.scheduledAt === "string" && body.scheduledAt.trim()) {
      const publication = await publications.schedule(
        publicationId,
        body.scheduledAt,
      );
      return NextResponse.json({ publication, scheduled: true });
    }

    const config = await autopilot.getConfig();
    const result = await scheduler.schedulePublication(publicationId, config);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo programar la publicación.";
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
