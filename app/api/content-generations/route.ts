import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ContentGenerationService } from "@/services/content-generation/ContentGenerationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = new ContentGenerationService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");

  for (const [label, value] of [
    ["planId", planId],
    ["projectId", projectId],
  ] as const) {
    if (value && !isProjectId(value)) {
      return NextResponse.json({ error: `${label} inválido.` }, { status: 400 });
    }
  }

  try {
    const generations = await content.list({
      ...(planId ? { planId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
    });
    return NextResponse.json(
      { generations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contentError(error);
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  try {
    const generation = await content.generate({
      planId: body.planId,
      variantCount: body.variantCount,
    });
    return NextResponse.json({ generation }, { status: 201 });
  } catch (error) {
    return contentError(error);
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

function contentError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo generar el contenido.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
