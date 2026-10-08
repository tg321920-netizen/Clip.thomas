import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { ResumableUploadStore, UploadError } from "@/services/ingest/ResumableUploadStore.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ uploadId: string; index: string }> }) {
  try {
    const { uploadId, index } = await context.params;
    if (!request.body || !/^\d+$/.test(index)) return NextResponse.json({ error: "Fragmento inválido." }, { status: 400 });
    const result = await new ResumableUploadStore().putChunk(uploadId, request.headers.get("x-upload-token"), Number(index), Readable.from(request.body as unknown as AsyncIterable<Uint8Array>), request.headers.get("x-chunk-sha256"), request.signal);
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar el fragmento.", code: error instanceof UploadError ? error.code : "UPLOAD_FAILED" }, { status: error instanceof UploadError ? error.status : 500 }); }
}
