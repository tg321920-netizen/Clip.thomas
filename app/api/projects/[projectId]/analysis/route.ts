import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
import {
  getAnalysisSourceKey,
  isAnalysisCurrent,
} from "@/services/analysis/ContentAnalysisService.mjs";
import { normalizeAnalysisOptions } from "@/services/analysis/TranscriptCandidateProvider.mjs";
import { JobStore } from "@/services/JobStore.mjs";

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
      analysis: project.analysis ?? null,
      job: await jobs.getAnalysisJob(projectId),
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

  if (
    project.transcript?.status !== "COMPLETED" ||
    !Array.isArray(project.transcript?.segments) ||
    project.transcript.segments.length === 0
  ) {
    return NextResponse.json(
      { error: "El proyecto necesita una transcripción completada primero." },
      { status: 409 },
    );
  }

  const sourceKey = getAnalysisSourceKey(project);
  if (isAnalysisCurrent(project, sourceKey)) {
    return NextResponse.json({
      analysis: project.analysis,
      job: await jobs.getAnalysisJob(projectId),
      reused: true,
    });
  }

  const body = await safeJson(request);
  const config = normalizeAnalysisOptions(body);
  const job = await jobs.enqueueAnalysis(projectId, config, {
    restartCompleted: true,
  });

  return NextResponse.json(
    {
      analysis: project.analysis ?? null,
      job,
      reused: false,
    },
    { status: 202 },
  );
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
