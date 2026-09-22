import { NextResponse } from "next/server";
import type { ClipRecord } from "@/types/clip";
import { isProjectId } from "@/lib/project-id.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import {
  createClipFromCandidate,
  listClips,
  markClipQueued,
} from "@/services/clip/ClipService.mjs";

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

  const clips = await listClips(projectId);
  if (clips === null) {
    return NextResponse.json(
      { error: "Proyecto no encontrado." },
      { status: 404 },
    );
  }

  const withJobs = await Promise.all(
    clips.map(async (clip: ClipRecord) => ({
      ...clip,
      job: await jobs.getRenderJob(projectId, clip.id),
    })),
  );

  return NextResponse.json(
    { clips: withJobs },
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

  const body = await safeJson(request);
  const candidateId =
    typeof body.candidateId === "string" ? body.candidateId.trim() : "";

  if (!/^candidate-\d{4}$/.test(candidateId)) {
    return NextResponse.json(
      { error: "candidateId inválido." },
      { status: 400 },
    );
  }

  try {
    const result = await createClipFromCandidate(projectId, candidateId, {
      framingMode: body.framingMode,
      quality: body.quality,
    });

    if (result.clip.status === "READY" && result.clip.render) {
      return NextResponse.json({
        clip: result.clip,
        job: await jobs.getRenderJob(projectId, result.clip.id),
        reused: true,
      });
    }

    await markClipQueued(projectId, result.clip.id);

    const job = await jobs.enqueueRender(
      projectId,
      result.clip.id,
      { clipId: result.clip.id },
      { restartCompleted: true },
    );

    return NextResponse.json(
      {
        clip: {
          ...result.clip,
          status: "QUEUED",
        },
        job,
        reused: result.reused,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo preparar el clip.";
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
