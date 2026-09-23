import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publications = new PublicationService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId");
  const projectId = url.searchParams.get("projectId");
  const clipId = url.searchParams.get("clipId");
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");

  for (const [label, value] of [
    ["channel", channelId],
    ["project", projectId],
    ["clip", clipId],
  ] as const) {
    if (value && !isProjectId(value)) {
      return NextResponse.json(
        { error: `Identificador de ${label} inválido.` },
        { status: 400 },
      );
    }
  }

  const records = await publications.list({
    ...(channelId ? { channelId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(clipId ? { clipId } : {}),
    ...(status ? { status: status.toUpperCase() } : {}),
    ...(platform ? { platform: platform.toUpperCase() } : {}),
  });

  return NextResponse.json(
    { publications: records },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  const projectId = stringValue(body.projectId);
  const clipId = stringValue(body.clipId);
  const channelId = stringValue(body.channelId);

  if (!isProjectId(projectId) || !isProjectId(clipId) || !isProjectId(channelId)) {
    return NextResponse.json(
      { error: "projectId, clipId y channelId deben ser UUID válidos." },
      { status: 400 },
    );
  }

  try {
    const result = await publications.createForClip({
      projectId,
      clipId,
      channelId,
      approvalRequired: body.approvalRequired !== false,
    });

    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return publicationError(error);
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function publicationError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudo crear la publicación.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
