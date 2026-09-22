import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
import { getLatestAutoEdit } from "@/services/autoedit/AutoEditService.mjs";
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

  const clip = await getLatestAutoEdit(projectId);

  return NextResponse.json(
    {
      autoEdit: clip?.autoEdit ?? null,
      clip: clip ?? null,
      job: await jobs.getAutoEditJob(projectId),
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
    project.analysis?.status !== "COMPLETED" ||
    !Array.isArray(project.analysis?.candidates) ||
    project.analysis.candidates.length === 0
  ) {
    return NextResponse.json(
      { error: "El análisis de contenido debe terminar antes de Auto Edit." },
      { status: 409 },
    );
  }

  const body = await safeJson(request);
  const candidateId =
    typeof body.candidateId === "string" ? body.candidateId.trim() : "";

  if (candidateId && !/^candidate-\d{4}$/.test(candidateId)) {
    return NextResponse.json(
      { error: "candidateId inválido." },
      { status: 400 },
    );
  }

  if (
    candidateId &&
    !project.analysis.candidates.some(
      (candidate: { id?: string }) => candidate.id === candidateId,
    )
  ) {
    return NextResponse.json(
      { error: "El candidato solicitado no existe en este proyecto." },
      { status: 404 },
    );
  }

  const job = await jobs.enqueueAutoEdit(
    projectId,
    {
      ...(candidateId ? { candidateId } : {}),
      generateSubtitles: true,
    },
    { restartCompleted: true },
  );

  return NextResponse.json(
    {
      job,
      autoEdit: null,
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
