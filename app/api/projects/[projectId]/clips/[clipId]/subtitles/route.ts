import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { getClip } from "@/services/clip/ClipService.mjs";
import {
  generateSubtitleTrack,
  getSubtitleTrack,
  updateSubtitleTrack,
} from "@/services/subtitles/SubtitleService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ projectId: string; clipId: string }>;
  },
) {
  const ids = await validIds(context);
  if (!ids.ok) return ids.response;

  const clip = await getClip(ids.projectId, ids.clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    {
      subtitles: await getSubtitleTrack(ids.projectId, ids.clipId),
      clipStatus: clip.status,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ projectId: string; clipId: string }>;
  },
) {
  const ids = await validIds(context);
  if (!ids.ok) return ids.response;

  const body = await safeJson(request);

  try {
    const subtitles = await generateSubtitleTrack(
      ids.projectId,
      ids.clipId,
      {
        style: body.style,
        enabled: body.enabled,
      },
    );

    return NextResponse.json({
      subtitles,
      renderInvalidated: true,
    });
  } catch (error) {
    return subtitleError(error);
  }
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ projectId: string; clipId: string }>;
  },
) {
  const ids = await validIds(context);
  if (!ids.ok) return ids.response;

  const body = await safeJson(request);

  try {
    const subtitles = await updateSubtitleTrack(
      ids.projectId,
      ids.clipId,
      {
        style: body.style,
        enabled: body.enabled,
        cues: body.cues,
      },
    );

    return NextResponse.json({
      subtitles,
      renderInvalidated: true,
    });
  } catch (error) {
    return subtitleError(error);
  }
}

async function validIds(context: {
  params: Promise<{ projectId: string; clipId: string }>;
}): Promise<
  | { ok: true; projectId: string; clipId: string }
  | { ok: false; response: NextResponse }
> {
  const { projectId, clipId } = await context.params;

  if (!isProjectId(projectId) || !isProjectId(clipId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Identificador inválido." },
        { status: 400 },
      ),
    };
  }

  return { ok: true, projectId, clipId };
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

function subtitleError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudieron guardar los subtítulos.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
