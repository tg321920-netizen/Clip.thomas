import { NextResponse } from "next/server";
import { getMediaToolStatus } from "@/services/MediaToolService";
import { getStorageStatus } from "@/services/StorageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [tools, storage] = await Promise.all([
    getMediaToolStatus(),
    getStorageStatus(),
  ]);

  const ready =
    tools.ffmpeg.available &&
    tools.ffprobe.available &&
    storage.writable;

  return NextResponse.json(
    {
      ready,
      tools,
      storage: {
        writable: storage.writable,
      },
      message: ready
        ? "FFmpeg, FFprobe y almacenamiento están disponibles."
        : "Este entorno todavía no puede procesar y guardar video de extremo a extremo.",
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
