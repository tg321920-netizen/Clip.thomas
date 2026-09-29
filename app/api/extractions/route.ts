import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ExtractionService } from "@/services/extraction/ExtractionService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extractions = new ExtractionService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceId = url.searchParams.get("sourceId");
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status")?.toUpperCase() || null;

  for (const [label, value] of [
    ["sourceId", sourceId],
    ["projectId", projectId],
  ] as const) {
    if (value && !isProjectId(value)) {
      return NextResponse.json({ error: `${label} inválido.` }, { status: 400 });
    }
  }

  if (status && !new Set(["COMPLETED", "FAILED"]).has(status)) {
    return NextResponse.json({ error: "Estado de extracción inválido." }, { status: 400 });
  }

  const records = await extractions.list({
    ...(sourceId ? { sourceId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
  });

  return NextResponse.json(
    { extractions: records },
    { headers: { "Cache-Control": "no-store" } },
  );
}
