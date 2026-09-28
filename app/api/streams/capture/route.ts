import { NextResponse } from "next/server";
import { parsePublicSourceUrl } from "@/lib/public-source-url.mjs";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = new IngestJobStore();

// Backward-compatible entry point. Stream capture is intentionally asynchronous:
// keeping an HTTP request open for minutes or hours is unreliable on hosted
// runtimes. Clients should poll /api/ingest/url/:jobId for real progress.
export async function POST(request: Request) {
  const body = await safeJson(request);
  const rawUrl = String(body.url || "").trim();

  let sourceUrl: URL;
  try {
    sourceUrl = await parsePublicSourceUrl(rawUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "La URL del stream no es válida." },
      { status: 400 },
    );
  }

  try {
    const job = await store.create({
      url: sourceUrl.toString(),
      mode: "STREAM",
      captureSeconds: body.durationSeconds ?? body.captureSeconds,
      segmentSeconds: body.segmentSeconds,
    });

    return NextResponse.json(
      {
        job: {
          id: job.id,
          projectId: job.projectId,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
        },
        statusUrl: `/api/ingest/url/${job.id}`,
        message: "La captura se ejecuta en segundo plano y ya no está limitada a 120 segundos.",
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Stream capture enqueue failed", {
      host: sourceUrl.hostname,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "No se pudo crear el trabajo de captura." },
      { status: 500 },
    );
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
