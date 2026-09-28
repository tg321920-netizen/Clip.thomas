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
      durable: ready && storage.durable,
      tools,
      storage: {
        writable: storage.writable,
        persistence: storage.persistence,
        durable: storage.durable,
        warning: storage.warning || null,
      },
      message: ready
        ? storage.durable
          ? "FFmpeg, FFprobe y almacenamiento persistente están disponibles."
          : "FFmpeg y FFprobe están disponibles, pero el almacenamiento actual es temporal y puede perderse al reemplazar la instancia."
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
