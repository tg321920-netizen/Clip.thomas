import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";
import { JobStore } from "@/services/JobStore.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factory = new ContentFactoryService();
const jobs = new JobStore();

export async function POST(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) {
    return NextResponse.json({ error: "Identificador de canal inválido." }, { status: 400 });
  }
  const body = await safeJson(request);
  try {
    const result = await factory.start(channelId, body);
    let mediaJob = null;
    if (result?.run?.execution?.status === "waiting_information") {
      mediaJob = await jobs.enqueueOwnedContent(result.execution.id, {
        reason: "Continue owned-content media stages on the ClipForge media runtime.",
      });
    }
    return NextResponse.json({ ...result, mediaJob }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Content Factory.";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 422 });
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
