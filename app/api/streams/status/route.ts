import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/bounded-json.mjs";
import { inspectLiveSource } from "@/services/live/LiveSourceService.mjs";
import { isKickSource, resolveKickSource } from "@/services/live/KickPublicSourceService.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = await readBoundedJson(request);
    const source = await inspectLiveSource(String(input.url || ""));
    let media = null;
    if (input.inspectMedia === true && isKickSource(String(input.url || ""))) {
      try {
        const resolved = await resolveKickSource(String(input.url));
        media = { state: resolved.metadata.sourceKind, metadataSource: "PUBLIC_VIEWER", captured: false,
          message: "Kick entregó una dirección multimedia. La captura y su decodificación todavía deben comprobarse." };
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SOURCE_UNAVAILABLE";
        media = { state: code === "SOURCE_OFFLINE" ? "OFFLINE" : "UNAVAILABLE", code, captured: false,
          message: code === "SOURCE_OFFLINE" ? "El canal está desconectado. Puedes usar un enlace específico de VOD autorizado." : "No se pudo resolver el medio público. Consulta el error de captura; no se presupone falta de credenciales." };
      }
    }
    return NextResponse.json({ source, media }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el directo. Revisa el enlace, el acceso a la API y la configuración de red." }, { status: 400 });
  }
}
