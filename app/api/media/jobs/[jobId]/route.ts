import { NextResponse } from "next/server";
import { JobStore } from "@/services/JobStore.mjs";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ jobId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { jobId } = await context.params;
    const job = await new JobStore().get(jobId);
    return NextResponse.json({ job }, { status: job ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Identificador de trabajo inválido." }, { status: 400 }); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { jobId } = await context.params; const store = new JobStore();
    const job = await store.get(jobId); if (!job || !job.type.startsWith("MEDIA_")) return NextResponse.json({ error: "Trabajo no encontrado." }, { status: 404 });
    const { action } = await readBoundedJson(request, 1000);
    if (action === "retry" && ["FAILED", "WAITING_RESOURCE", "CANCELLED"].includes(job.status)) return NextResponse.json({ job: await store.enqueueMedia(job.type, job.projectId, job.payload) }, { status: 202 });
    if (action === "cancel" && ["QUEUED", "WAITING_RESOURCE"].includes(job.status)) return NextResponse.json({ job: await store.transition(job.id, "CANCELLED", "CANCELLED") });
    return NextResponse.json({ error: "No se puede realizar esa acción en el estado actual." }, { status: 409 });
  } catch { return NextResponse.json({ error: "No se pudo actualizar el trabajo." }, { status: 400 }); }
}
