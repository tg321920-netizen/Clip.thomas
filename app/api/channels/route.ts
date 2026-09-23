import { NextResponse } from "next/server";
import { ChannelService } from "@/services/channels/ChannelService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channels = new ChannelService();

export async function GET() {
  return NextResponse.json(
    { channels: await channels.listChannels() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = await safeJson(request);

  try {
    const channel = await channels.createChannel(body);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    return channelError(error);
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

function channelError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudo guardar el canal.";
  return NextResponse.json({ error: message }, { status: 422 });
}
