import { NextResponse } from "next/server";
import { parsePublicSourceUrl } from "@/lib/public-source-url.mjs";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = new IngestJobStore();

export async function POST(request: Request) {
  const body = await safeJson(request);
  const rawUrl = String(body.url || "").trim();
  const mode = String(body.mode || "IMPORT").trim().toUpperCase();

  if (!new Set(["IMPORT", "STREAM"]).has(mode)) {
    return NextResponse.json(
      { error: "El modo debe ser IMPORT o STREAM." },
      { status: 400 },
    );
  }

  let url: URL;
  try {
    url = await parsePublicSourceUrl(rawUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "URL no válida." },
      { status: 400 },
    );
  }

  try {
    const job = await store.create({
      url: url.toString(),
      mode,
      captureSeconds: body.captureSeconds,
      segmentSeconds: body.segmentSeconds,
    });

    return NextResponse.json(
      {
        job: publicJob(job as Record<string, unknown>),
        statusUrl: `/api/ingest/url/${job.id}`,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("URL ingest enqueue failed", {
      host: url.hostname,
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "No se pudo crear el trabajo de ingesta." },
      { status: 500 },
    );
  }
}

function publicJob(job: Record<string, unknown>) {
  const source = isRecord(job.source) ? job.source : {};
  let displayUrl = "";
  try {
    const rawUrl = typeof source.url === "string" ? source.url : "";
    const url = new URL(rawUrl);
    displayUrl = `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    displayUrl = "";
  }

  return {
    ...job,
    source: {
      ...source,
      url: displayUrl,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
