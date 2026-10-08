import { createUploadHandlers } from "@/services/ingest/ResumableUploadHandlers.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ uploadId: string }> };
export async function GET(request: Request, context: Context) {
  return createUploadHandlers().status(request, (await context.params).uploadId);
}
export async function POST(request: Request, context: Context) {
  return createUploadHandlers().finalize(request, (await context.params).uploadId);
}
