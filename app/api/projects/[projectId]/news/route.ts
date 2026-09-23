import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import {
  getNewsBrief,
  markNewsReadyForRetry,
  prepareNewsBrief,
} from "@/services/news/NewsService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new JobStore();

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  if (!isProjectId(projectId)) {
    return NextResponse.json(
      { error: "Identificador de proyecto inválido." },
      { status: 400 },
    );
  }

  const project = await loadProjectFile(projectId);
  if (!project) {
    return NextResponse.json(
      { error: "Proyecto no encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      newsBrief: await getNewsBrief(projectId),
      job: await jobs.getNewsRenderJob(projectId),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  if (!isProjectId(projectId)) {
    return NextResponse.json(
      { error: "Identificador de proyecto inválido." },
      { status: 400 },
    );
  }

  const project = await loadProjectFile(projectId);
  if (!project) {
    return NextResponse.json(
      { error: "Proyecto no encontrado." },
      { status: 404 },
    );
  }

  const body = await safeJson(request);
  const action = String(body.action || "prepare").toLowerCase();

  try {
    if (action === "prepare") {
      const result = await prepareNewsBrief(projectId, {
        targetWords: body.targetWords,
        template: body.template,
      });

      return NextResponse.json({
        newsBrief: result.newsBrief,
        reused: result.reused,
        job: await jobs.getNewsRenderJob(projectId),
      });
    }

    if (action === "render") {
      let brief = await getNewsBrief(projectId);
      if (!brief) {
        const prepared = await prepareNewsBrief(projectId, {
          targetWords: body.targetWords,
          template: body.template,
        });
        brief = prepared.newsBrief;
      }

      if (brief.status === "FAILED") {
        brief = await markNewsReadyForRetry(projectId);
      }

      if (brief.status === "RENDERED" && brief.render) {
        return NextResponse.json({
          newsBrief: brief,
          reused: true,
          job: await jobs.getNewsRenderJob(projectId),
        });
      }

      const job = await jobs.enqueueNewsRender(
        projectId,
        {},
        { restartCompleted: true },
      );

      return NextResponse.json(
        {
          newsBrief: brief,
          job,
          reused: false,
        },
        { status: 202 },
      );
    }

    return NextResponse.json(
      { error: "Acción de News Mode no soportada." },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "News Mode falló.";
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
