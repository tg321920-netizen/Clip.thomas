import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";
import { TrendHunterService } from "@/services/owned-content/TrendHunterService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factory = new ContentFactoryService();
const trends = new TrendHunterService();

export async function POST(
  _request: Request,
  context: { params: Promise<{ trendId: string }> },
) {
  const { trendId } = await context.params;
  if (!isProjectId(trendId)) {
    return NextResponse.json({ error: "Identificador de tendencia inválido." }, { status: 400 });
  }

  try {
    const trend = await trends.get(trendId);
    if (!trend) return NextResponse.json({ error: "Tendencia no encontrada." }, { status: 404 });
    const view = await factory.getChannelView(trend.channelId);
    if (!view.profile.enabled || !view.profile.lineKey) {
      throw new Error("El canal de esta tendencia ya no está activo en Content Factory.");
    }
    return NextResponse.json(await trends.select(trendId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo seleccionar la tendencia." },
      { status: 422 },
    );
  }
}
