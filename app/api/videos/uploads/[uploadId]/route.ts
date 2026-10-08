import { NextResponse } from "next/server";
import { ResumableUploadStore, UploadError } from "@/services/ingest/ResumableUploadStore.mjs";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ uploadId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { uploadId } = await context.params;
    const session = await new ResumableUploadStore().status(uploadId, request.headers.get("x-upload-token"));
    const job = await new IngestJobStore().get(uploadId);
    return NextResponse.json({ session, job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { uploadId } = await context.params;
    const jobs = new IngestJobStore();
    const session = await new ResumableUploadStore().finalize(uploadId, request.headers.get("x-upload-token"), (input: { id: string; relativePath: string; filename: string; mimeType: string; size: number; sha256: string }) => jobs.enqueueUpload(input));
    return NextResponse.json({ session, job: await jobs.get(uploadId) }, { status: 202 });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "La subida falló.", code: error instanceof UploadError ? error.code : "UPLOAD_FAILED" }, { status: error instanceof UploadError ? error.status : 500 }); }
