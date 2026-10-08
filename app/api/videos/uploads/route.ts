import { createUploadHandlers } from "@/services/ingest/ResumableUploadHandlers.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return createUploadHandlers().create(request);
}
