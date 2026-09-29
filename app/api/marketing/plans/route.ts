import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { MarketingBrainService } from "@/services/marketing-brain/MarketingBrainService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const marketingBrain = new MarketingBrainService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const objective = url.searchParams.get("objective");
  const mode = url.searchParams.get("mode");

  if (projectId && !isProjectId(projectId)) {
    return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  }

  try {
    const plans = await marketingBrain.list({
      ...(projectId ? { projectId } : {}),
      ...(objective ? { objective } : {}),
      ...(mode ? { mode } : {}),
    });
    return NextResponse.json(
      { plans },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);

  try {
    const plan = await marketingBrain.createPlan({
      extractionIds: body.extractionIds,
      projectId: body.projectId,
      objective: body.objective,
      audience: body.audience,
      channels: body.channels,
      format: body.format,
      instructions: body.instructions,
      language: body.language,
      mode: body.mode,
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function marketingError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo crear el plan de marketing.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
