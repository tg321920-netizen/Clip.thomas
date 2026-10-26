import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { JobStore } from "@/services/JobStore.mjs";
import { isProjectId } from "@/lib/project-id.mjs";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";
import { getStoryProviderStatus } from "@/services/owned-content/StoryGenerationProviders.mjs";
import { releasePolicy } from "@/lib/release-policy.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = await readBoundedJson(request);
    if (!["MEDIA_STORY", "MEDIA_EDIT", "MEDIA_CLIPS"].includes(input.type)) return NextResponse.json({ error: "Herramienta inválida." }, { status: 400 });
    if(input.type==='MEDIA_STORY'&&!releasePolicy().features.stories)return NextResponse.json({error:'La creación de historias está separada en el entorno de desarrollo.'},{status:409});
    const payload = input.payload || {};
    if(input.type==='MEDIA_CLIPS'&&!releasePolicy().experimental)payload.analysisProvider='heuristic';
    if (JSON.stringify(payload).length > 20000) return NextResponse.json({ error: "El guion o la solicitud es demasiado grande." }, { status: 413 });
    const id = isProjectId(input.id) ? input.id : randomUUID();
    const job = await new JobStore().enqueueMedia(input.type, id, payload);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el trabajo." }, { status: 400 }); }
}
export async function GET() {
  const [{ jobs, issues }, ingests] = await Promise.all([new JobStore().listMediaWithIssues(),new IngestJobStore().list(30)]);
  const uploads = ingests.map(job => ({ id:job.id,type:job.type,name:job.source.filename || "Importación URL",status:job.status,stage:job.stage,progress:job.progress,retryable:job.retryable,error:job.error,createdAt:job.createdAt }));
  return NextResponse.json({ jobs,issues,uploads,story:getStoryProviderStatus() }, { headers: { "Cache-Control": "no-store" } });
}

