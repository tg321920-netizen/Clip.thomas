import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { parseByteRange } from "@/lib/http-range.mjs";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
import { resolveStoragePath } from "@/lib/storage-paths.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const project = await loadProjectFile(projectId);
  const relativePath = project?.newsBrief?.render?.relativePath;

  if (!relativePath || project?.newsBrief?.status !== "RENDERED") {
    return NextResponse.json(
      { error: "Video de noticias no encontrado." },
      { status: 404 },
    );
  }

  let filePath: string;
  try {
    filePath = resolveStoragePath(relativePath);
  } catch {
    return NextResponse.json({ error: "Ruta inválida." }, { status: 400 });
  }

  try {
    const fileStat = await stat(filePath);
    const range = request.headers.get("range");

    if (!range) {
      const stream = createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: headersFor(fileStat.size),
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
        ...headersFor(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      },
    });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;

    if (code === "ENOENT") {
      return NextResponse.json(
        { error: "Archivo de noticias no encontrado." },
        { status: 404 },
      );
    }

    console.error("News video streaming failed", error);
    return NextResponse.json(
      { error: "No se pudo reproducir el video de noticias." },
      { status: 500 },
    );
  }
}

function headersFor(contentLength: number): Record<string, string> {
  return {
    "Content-Type": "video/mp4",
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  };
}
