import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
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
      transcript: project.transcript ?? null,
      job: await jobs.getTranscriptionJob(projectId),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
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

  if (
    project.transcript?.status === "COMPLETED" &&
    Array.isArray(project.transcript?.segments) &&
    project.transcript.segments.length > 0
  ) {
    return NextResponse.json({
      transcript: project.transcript,
      job: await jobs.getTranscriptionJob(projectId),
      reused: true,
    });
  }

  const job = await jobs.enqueueTranscription(projectId);

  return NextResponse.json(
    {
      transcript: project.transcript ?? null,
      job,
      reused: false,
    },
    { status: 202 },
  );
}
