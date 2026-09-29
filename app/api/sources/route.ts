import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { SourceService } from "@/services/sources/SourceService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sources = new SourceService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const projectId = url.searchParams.get("projectId");

  if (projectId && !isProjectId(projectId)) {
    return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  }

  try {
    const records = await sources.list({
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
    });
    return NextResponse.json(
      { sources: records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return sourceError(error);
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);

  try {
    const source = await sources.create({
      type: body.type,
      text: body.text,
      url: body.url,
      projectId: body.projectId,
      authorizationConfirmed: body.authorizationConfirmed,
      metadata: body.metadata,
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    return sourceError(error);
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

function sourceError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo procesar la fuente.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
