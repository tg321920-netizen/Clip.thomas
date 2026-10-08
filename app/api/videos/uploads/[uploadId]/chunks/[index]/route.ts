import { createUploadHandlers } from "@/services/ingest/ResumableUploadHandlers.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ uploadId: string; index: string }> }) {
  const { uploadId, index } = await context.params;
  return createUploadHandlers().chunk(request, uploadId, index);
}
