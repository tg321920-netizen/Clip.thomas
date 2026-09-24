import { NextResponse } from "next/server";
import { getMediaToolStatus } from "@/services/MediaToolService";
import { getStorageStatus } from "@/services/StorageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [media, storage] = await Promise.all([
    getMediaToolStatus(),
    getStorageStatus(),
  ]);

  const ready = media.ffmpeg.available && media.ffprobe.available && storage.writable;

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      mediaReady: ready,
      ffmpeg: media.ffmpeg.available,
      ffprobe: media.ffprobe.available,
      storageWritable: storage.writable,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
