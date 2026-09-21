import { NextResponse } from "next/server";
import { ProjectStore } from "@/services/ProjectStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = new ProjectStore();

export async function GET() {
  try {
    const records = await store.list(20);
    const projects = records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      source: {
        projectId: record.source.projectId,
        originalName: record.source.originalName,
        storedName: record.source.storedName,
        sizeBytes: record.source.sizeBytes,
        posterUrl: record.source.posterUrl,
        sourceUrl: record.source.sourceUrl,
        durationSeconds: record.source.durationSeconds,
        width: record.source.width,
        height: record.source.height,
        fps: record.source.fps,
        codec: record.source.codec,
        container: record.source.container,
        aspectRatio: record.source.aspectRatio,
      },
    }));

    return NextResponse.json(
      { projects },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Project listing failed", error);
    return NextResponse.json(
      { error: "No se pudieron cargar los proyectos." },
      { status: 500 },
    );
  }
}
