import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { JobStore } from "@/services/JobStore.mjs";
import { isProjectId } from "@/lib/project-id.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = await request.json();
    if (!["MEDIA_STORY", "MEDIA_EDIT", "MEDIA_CLIPS"].includes(input.type)) return NextResponse.json({ error: "Herramienta inválida." }, { status: 400 });
    const payload = input.payload || {};
    if (JSON.stringify(payload).length > 20000) return NextResponse.json({ error: "El guion o la solicitud es demasiado grande." }, { status: 413 });
    const id = isProjectId(input.id) ? input.id : randomUUID();
    const job = await new JobStore().enqueueMedia(input.type, id, payload);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el trabajo." }, { status: 400 }); }
}
