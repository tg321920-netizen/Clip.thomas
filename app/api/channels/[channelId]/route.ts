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
    return NextResponse.json({ error: "Identificador de canal inválido." }, { status: 400 });
  }

  const channel = await channels.getChannel(channelId);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    { channel },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) {
    return NextResponse.json({ error: "Identificador de canal inválido." }, { status: 400 });
  }

  const body = await safeJson(request);

  try {
    const channel = await channels.updateChannel(channelId, body);
    return NextResponse.json({ channel });
  } catch (error) {
    return channelError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) {
    return NextResponse.json({ error: "Identificador de canal inválido." }, { status: 400 });
  }

  const deleted = await channels.deleteChannel(channelId);
  if (!deleted) {
    return NextResponse.json({ error: "Canal no encontrado." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
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

function channelError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudo actualizar el canal.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
