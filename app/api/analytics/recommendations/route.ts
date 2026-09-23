import { NextResponse } from "next/server";
import { PerformanceAnalyzer } from "@/services/learning/PerformanceAnalyzer.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analyzer = new PerformanceAnalyzer();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform")?.trim().toUpperCase() || null;
  const channelId = url.searchParams.get("channelId")?.trim() || null;

  if (platform && !["TIKTOK", "YOUTUBE", "FACEBOOK"].includes(platform)) {
    return NextResponse.json({ error: "Plataforma inválida." }, { status: 400 });
  }

  try {
    const result = await analyzer.analyze({ platform, channelId });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron analizar las métricas.",
      },
      { status: 422 },
    );
  }
}
