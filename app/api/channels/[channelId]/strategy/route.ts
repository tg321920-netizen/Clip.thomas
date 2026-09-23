import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ChannelService } from "@/services/channels/ChannelService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channels = new ChannelService();

export async function GET(
  _request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) {
    return NextResponse.json(
      { error: "Identificador de canal inválido." },
      { status: 400 },
    );
  }

  const strategy = await channels.getStrategy(channelId);
  if (!strategy) {
    return NextResponse.json(
      { error: "Canal no encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { strategy },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) {
    return NextResponse.json(
      { error: "Identificador de canal inválido." },
      { status: 400 },
    );
  }

  const body = await safeJson(request);

  try {
    const strategy = await channels.updateStrategy(channelId, body);
    return NextResponse.json({ strategy });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo actualizar la estrategia.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
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
