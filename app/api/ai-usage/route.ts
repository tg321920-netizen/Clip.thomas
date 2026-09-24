import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { AIUsageService } from "@/services/ai/AIUsageService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usage = new AIUsageService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() || null;
  if (projectId && !isProjectId(projectId)) {
    return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  }

  const filters = projectId ? { projectId } : {};
  const [records, summary] = await Promise.all([
    usage.list(filters),
    usage.summary(filters),
  ]);

  return NextResponse.json(
    { summary, records: records.slice(-100).reverse() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
