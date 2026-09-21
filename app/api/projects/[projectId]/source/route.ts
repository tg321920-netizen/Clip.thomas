import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { parseByteRange } from "@/lib/http-range.mjs";
import { isProjectId } from "@/lib/project-id.mjs";
import { getStorageRoot } from "@/services/StorageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_PATTERN = /^source\.(mp4|mov|webm)$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  if (!isProjectId(projectId)) {
    return NextResponse.json(
      { error: "Identificador de proyecto inválido." },
      { status: 400 },
    );
  }

  const uploadDir = path.join(getStorageRoot(), "uploads", projectId);

  let sourceName: string;
  try {
    const entries = await readdir(uploadDir);
    const found = entries.find((entry) => SOURCE_PATTERN.test(entry));
    if (!found) {
      return NextResponse.json(
        { error: "Video fuente no encontrado." },
        { status: 404 },
      );
    }
    sourceName = found;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return NextResponse.json(
        { error: "Proyecto no encontrado." },
        { status: 404 },
      );
    }

    console.error("Source lookup failed", error);
    return NextResponse.json(
      { error: "No se pudo acceder al video fuente." },
      { status: 500 },
    );
  }

  const filePath = path.join(uploadDir, sourceName);

  try {
    const fileStat = await stat(filePath);
    const mimeType = mimeFor(sourceName);
    const range = request.headers.get("range");

    if (!range) {
      const stream = createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(fileStat.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=0, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const parsed = parseByteRange(range, fileStat.size);
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileStat.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const { start, end } = parsed;
    const stream = createReadStream(filePath, { start, end });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return NextResponse.json(
        { error: "Video fuente no encontrado." },
        { status: 404 },
      );
    }

    console.error("Source streaming failed", error);
    return NextResponse.json(
      { error: "No se pudo reproducir el video fuente." },
      { status: 500 },
    );
  }
}

function mimeFor(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

function getErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}
