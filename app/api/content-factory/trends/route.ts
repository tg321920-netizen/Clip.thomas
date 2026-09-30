import { NextResponse } from "next/server";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";
import { TrendHunterService } from "@/services/owned-content/TrendHunterService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factory = new ContentFactoryService();
const trends = new TrendHunterService();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId") || undefined;
    const state = url.searchParams.get("state") || undefined;

    if (channelId) await factory.getChannelView(channelId);
    const records = await trends.list({ channelId, state });
    return NextResponse.json({ trends: records }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar las tendencias." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  try {
    const channelId = String(body.channelId || "").trim();
    const view = await factory.getChannelView(channelId);
    if (!view.profile.enabled || !view.profile.lineKey) {
      throw new Error("Activa el canal y asigna una línea de Content Factory antes de registrar tendencias.");
    }

    const trend = await trends.ingest({ ...body, channelId }, view.profile);
    return NextResponse.json(trend, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo clasificar la tendencia.";
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
