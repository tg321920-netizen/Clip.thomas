import { NextResponse } from "next/server";
import type { ClipRecord } from "@/types/clip";
import { isProjectId } from "@/lib/project-id.mjs";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import {
  createClipFromCandidate,
  createManualClip,
  listClips,
  markClipQueued,
  getClip,
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

  let body: Record<string, unknown>;
  try { body = await readBoundedJson(request, 4000); }
  catch { return NextResponse.json({ error: 'Solicitud de recorte inválida.' }, { status: 400 }); }
  if(body.retryClipId!==undefined){
    try{
    if(!isProjectId(body.retryClipId))return NextResponse.json({error:'Identificador de recorte inválido.'},{status:400});
    const clip=await getClip(projectId,body.retryClipId);
    if(!clip)return NextResponse.json({error:'Recorte no encontrado.'},{status:404});
    const current=await jobs.getRenderJob(projectId,clip.id);
    if(current&&['QUEUED','PROCESSING','VALIDATING'].includes(current.status))return NextResponse.json({clip,job:current,reused:true},{status:202});
    await markClipQueued(projectId,clip.id);
    const job=await jobs.enqueueRender(projectId,clip.id,{clipId:clip.id},{restartCompleted:true});
    return NextResponse.json({clip:{...clip,status:'QUEUED'},job,reused:true},{status:202});
    }catch{return NextResponse.json({error:'No se pudo reanudar el recorte. El trabajo se conserva para revisión.'},{status:503});}
  }
  const manual = body.startTime !== undefined || body.endTime !== undefined;
  const candidateId =
    typeof body.candidateId === "string" ? body.candidateId.trim() : "";

  if (!manual && !/^candidate-\d{4}$/.test(candidateId)) {
    return NextResponse.json(
      { error: "candidateId inválido." },
      { status: 400 },
    );
  }

  try {
    const result = manual ? await createManualClip(projectId, body) : await createClipFromCandidate(projectId, candidateId, {
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
    const status = /not found|no encontrado/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
