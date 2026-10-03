import { NextResponse } from "next/server";
import { getSmartPublishJobStatus } from "@/services/publishing/SmartPublishJobService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getSmartPublishJobStatus();
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
