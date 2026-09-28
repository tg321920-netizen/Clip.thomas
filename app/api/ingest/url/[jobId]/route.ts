import { NextResponse } from "next/server";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = new IngestJobStore();

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  try {
    const job = await store.get(jobId);
    if (!job) {
      return NextResponse.json({ error: "Trabajo de ingesta no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ job: publicJob(job) });
  } catch {
    return NextResponse.json({ error: "Identificador de ingesta inválido." }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const body = await safeJson(request);
  if (String(body.action || "").toUpperCase() !== "RETRY") {
    return NextResponse.json({ error: "Acción no soportada." }, { status: 400 });
  }

  try {
    const job = await store.retry(jobId);
    if (!job) {
      return NextResponse.json({ error: "Trabajo de ingesta no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ job: publicJob(job) }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo reintentar." },
      { status: 409 },
    );
  }
}

function publicJob(job: Record<string, any>) {
  let displayUrl = "";
  try {
    const url = new URL(job?.source?.url || "");
    displayUrl = `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    displayUrl = "";
  }
  return { ...job, source: { ...job.source, url: displayUrl } };
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
