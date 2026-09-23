import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { JobStore } from "@/services/JobStore.mjs";
import { markClipQueued } from "@/services/clip/ClipService.mjs";
import {
  applySpeechFocus,
  disableAutoReframe,
  getAutoReframe,
} from "@/services/reframe/AutoReframeService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new JobStore();

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ projectId: string; clipId: string }>;
  },
) {
  const ids = await validIds(context);
  if (!ids.ok) return ids.response;

  const autoReframe = await getAutoReframe(ids.projectId, ids.clipId);

  return NextResponse.json(
    { autoReframe },
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
    const autoReframe = await applySpeechFocus(
      ids.projectId,
      ids.clipId,
      body,
    );

    await markClipQueued(ids.projectId, ids.clipId);
    const job = await jobs.enqueueRender(
      ids.projectId,
      ids.clipId,
      { clipId: ids.clipId },
      { restartCompleted: true },
    );

    return NextResponse.json(
      { autoReframe, job },
      { status: 202 },
    );
  } catch (error) {
    return reframeError(error);
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
    const enabled = body.enabled !== false;
    const autoReframe = enabled
      ? await applySpeechFocus(ids.projectId, ids.clipId, body)
      : await disableAutoReframe(ids.projectId, ids.clipId);

    await markClipQueued(ids.projectId, ids.clipId);
    const job = await jobs.enqueueRender(
      ids.projectId,
      ids.clipId,
      { clipId: ids.clipId },
      { restartCompleted: true },
    );

    return NextResponse.json(
      { autoReframe, job },
      { status: 202 },
    );
  } catch (error) {
    return reframeError(error);
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

function reframeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudo configurar Auto Focus.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
