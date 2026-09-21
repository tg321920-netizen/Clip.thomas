import { NextResponse } from "next/server";
import { getMediaToolStatus } from "@/services/MediaToolService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tools = await getMediaToolStatus();
  const ready = tools.ffmpeg.available && tools.ffprobe.available;

  return NextResponse.json(
    {
      ready,
      tools,
      message: ready
        ? "FFmpeg y FFprobe están disponibles."
        : "Este entorno todavía no tiene todas las herramientas de video disponibles.",
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
