import { NextResponse } from "next/server";
import { ResumableUploadStore, UploadError } from "@/services/ingest/ResumableUploadStore.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
    const input = await request.json();
    const session = await new ResumableUploadStore().create(input);
    return NextResponse.json({ session }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar la subida." }, { status: error instanceof UploadError ? error.status : 400 });
  }
}
