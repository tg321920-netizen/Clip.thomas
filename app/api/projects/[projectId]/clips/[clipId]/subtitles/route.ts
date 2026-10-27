import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import { markClipQueued } from "@/services/clip/ClipService.mjs";
import { getClip } from "@/services/clip/ClipService.mjs";
import {
  generateSubtitleTrack,
  getSubtitleTrack,
  updateSubtitleTrack,
  buildSrtDocument,
  requestSubtitleMode,
  restoreSubtitleVersion,
} from "@/services/subtitles/SubtitleService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
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

  const versionId = new URL(request.url).searchParams.get('version');
  const track = versionId ? clip.subtitleHistory?.find((v: { versionId: string })=>v.versionId===versionId)?.track : await getSubtitleTrack(ids.projectId, ids.clipId);
  if (versionId && !track) return NextResponse.json({ error: 'Versión no encontrada.' }, { status: 404 });
  if (new URL(request.url).searchParams.get("format") === "srt") {
    if (!track?.cues?.length) return NextResponse.json({ error: "Este recorte todavía no tiene subtítulos." }, { status: 404 });
    return new Response(buildSrtDocument(track), { headers: {
      "Content-Type": "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename="clip-${ids.clipId}.srt"`,
      "Cache-Control": "private, no-store",
    } });
  }
  return NextResponse.json(
    {
      subtitles: track,
      clipStatus: clip.status,
      history: (clip.subtitleHistory || []).map((v: { versionId: string; savedAt: string; reason: string })=>({ versionId: v.versionId, savedAt: v.savedAt, reason: v.reason })),
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

  try {
    const body = await safeJson(request);
    if (body.mode !== undefined) {
      const clip = await requestSubtitleMode(ids.projectId, ids.clipId, body.mode, typeof body.style === "string" ? body.style : "CLEAN");
      await markClipQueued(ids.projectId, ids.clipId);
      const job = await new JobStore().enqueueRender(ids.projectId, ids.clipId, { clipId: ids.clipId }, { restartCompleted: true });
      return NextResponse.json({ subtitles: clip.subtitles || null, job, renderInvalidated: true }, { status: 202 });
    }
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
      renderInvalidated: (await getClip(ids.projectId, ids.clipId))?.status !== "READY",
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

  try {
    const body = await safeJson(request);
    const subtitles = typeof body.restoreVersion === 'string' ? await restoreSubtitleVersion(ids.projectId,ids.clipId,body.restoreVersion) : await updateSubtitleTrack(
      ids.projectId,
      ids.clipId,
      {
        style: body.style,
        enabled: body.enabled,
        cues: body.cues,
        layout: body.layout,
        expectedUpdatedAt: body.expectedUpdatedAt,
      },
    );

    return NextResponse.json({
      subtitles,
      renderInvalidated: (await getClip(ids.projectId, ids.clipId))?.status !== "READY",
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
    const value = await readBoundedJson(request, 250_000);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Solicitud de subtítulos inválida o demasiado grande.");
  }
}

function subtitleError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudieron guardar los subtítulos.";
  const status = /not found/i.test(message) ? 404 : /Espera a que termine|otra sesión/.test(message) ? 409 : 422;
  return NextResponse.json({ error: message }, { status });
}
