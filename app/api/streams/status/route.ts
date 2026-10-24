import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
import { inspectLiveSource } from "@/services/live/LiveSourceService.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = await readBoundedJson(request);
    const source = await inspectLiveSource(String(input.url || ""));
    return NextResponse.json({ source }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el directo. Revisa el enlace, el acceso a la API y la configuración de red." }, { status: 400 });
  }
}
