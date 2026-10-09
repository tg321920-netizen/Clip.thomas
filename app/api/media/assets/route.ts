import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "@/lib/storage-paths.mjs";
import { writeAll } from "@/lib/write-all.mjs";
import { probeMediaFile } from "@/services/media-processing/MediaValidationService.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
class InvalidAssetError extends Error {}
export async function POST(request: Request) {
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a" };
  const mime = request.headers.get("content-type") || "", extension = extensions[mime];
  if (!extension || !request.body || request.headers.get("x-rights-confirmed") !== "true") return NextResponse.json({ error: "Elige una imagen o audio compatible y confirma que tienes derechos de uso." }, { status: 400 });
  const relativePath = path.posix.join("story-assets", `${randomUUID()}.${extension}`);
  const filename = path.join(getStorageRoot(), relativePath), temporary = `${filename}.part`;
  let handle;
  try {
    await mkdir(path.dirname(filename), { recursive: true }); handle = await open(temporary, "wx"); let bytes = 0;
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { bytes += chunk.byteLength; if (bytes > 4 * 1024 * 1024) throw new InvalidAssetError("El recurso supera 4 MB. Utiliza una versión más pequeña."); await writeAll(handle, chunk); }
    await handle.sync(); await handle.close(); handle = null;
    const prefixHandle = await open(temporary, "r"); const prefix = Buffer.alloc(16); await prefixHandle.read(prefix,0,16,0); await prefixHandle.close();
    const signatures: Record<string, boolean> = {
      jpg: prefix[0] === 0xff && prefix[1] === 0xd8,
      png: prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      webp: prefix.toString("ascii",0,4) === "RIFF" && prefix.toString("ascii",8,12) === "WEBP",
      wav: prefix.toString("ascii",0,4) === "RIFF" && prefix.toString("ascii",8,12) === "WAVE",
      mp3: prefix.toString("ascii",0,3) === "ID3" || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0),
      m4a: prefix.toString("ascii",4,8) === "ftyp",
    };
    if (!signatures[extension]) throw new InvalidAssetError("El contenido del recurso no corresponde al tipo de archivo declarado.");
    const probe = await probeMediaFile(temporary);
    if (mime.startsWith("image/") ? !probe.video?.width || probe.video.width > 6000 || probe.video.height > 6000 || probe.video.width*probe.video.height>12_000_000 : !probe.audio) throw new InvalidAssetError("El recurso no contiene una imagen válida de hasta doce megapíxeles o una pista de audio compatible.");
    await rename(temporary, filename);
    return NextResponse.json({ relativePath, sizeBytes: bytes, rights: "USER_CONFIRMED" });
  } catch (error) {
    const invalid = error instanceof InvalidAssetError;
    if (!invalid) console.error("Story asset upload failed", error);
    return NextResponse.json({ error: invalid ? error.message : "El servidor interrumpió la carga del recurso. Intenta nuevamente.", code: invalid ? "INVALID_ASSET" : "ASSET_UPLOAD_UNAVAILABLE" }, { status: invalid ? 422 : 503 });
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
