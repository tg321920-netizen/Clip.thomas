import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factory = new ContentFactoryService();

export async function GET(
  _request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) return invalid();
  try {
    return NextResponse.json(await factory.getChannelView(channelId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return factoryError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isProjectId(channelId)) return invalid();
  const body = await safeJson(request);
  try {
    return NextResponse.json(await factory.configure(channelId, body));
  } catch (error) {
    return factoryError(error);
  }
}

function invalid() {
  return NextResponse.json({ error: "Identificador de canal inválido." }, { status: 400 });
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

function factoryError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo actualizar Content Factory.";
  return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 422 });
}
