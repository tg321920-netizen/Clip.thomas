import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  MAX_UPLOAD_BYTES,
  sanitizeOriginalName,
  validateUploadDescriptor,
} from "@/lib/upload-policy.mjs";
import { ProjectStore } from "@/services/ProjectStore";
import {
  VideoProcessingError,
  VideoProcessor,
} from "@/services/VideoProcessor";
import type { UploadedVideo } from "@/types/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const videoProcessor = new VideoProcessor();
const projectStore = new ProjectStore();

export async function POST(request: Request) {
  if (!request.body) {
    return NextResponse.json(
      { error: "No se recibió ningún archivo." },
      { status: 400 },
    );
  }

  const encodedName = request.headers.get("x-file-name") || "";
  const originalName = sanitizeOriginalName(safeDecode(encodedName));
  const mimeType = request.headers.get("content-type") || "";
  const declaredSize = Number(
    request.headers.get("x-file-size") ||
      request.headers.get("content-length") ||
      "0",
  );

  const validation = validateUploadDescriptor({
    filename: originalName,
    mimeType,
    size: declaredSize,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const projectId = randomUUID();
  const storedName = `source.${validation.extension}`;
  const uploadDir = path.join(
    process.cwd(),
    "storage",
    "uploads",
    projectId,
  );
  const filePath = path.join(uploadDir, storedName);

  await mkdir(uploadDir, { recursive: true });

  let bytesWritten = 0;
  const file = await open(filePath, "wx");

  try {
    const reader = request.body.getReader();

    while (true) {
      if (request.signal.aborted) {
        throw new UploadError("La subida fue cancelada.", 499);
      }

      const { done, value } = await reader.read();
      if (done) break;

      bytesWritten += value.byteLength;
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        throw new UploadError(
          "El archivo supera el límite actual de 1 GB.",
          413,
        );
      }

      await file.write(value);
    }
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(uploadDir, { recursive: true, force: true });

    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Upload stream failed", error);
    return NextResponse.json(
      { error: "No se pudo guardar el video." },
      { status: 500 },
    );
  }

  await file.close();

  if (bytesWritten === 0 || bytesWritten !== declaredSize) {
    await rm(uploadDir, { recursive: true, force: true });
    return NextResponse.json(
      { error: "La subida quedó incompleta. Intenta nuevamente." },
      { status: 400 },
    );
  }

  try {
    const technical = await videoProcessor.probe(filePath);

    const video: UploadedVideo = {
      projectId,
      originalName,
      storedName,
      sizeBytes: bytesWritten,
      ...technical,
    };

    await projectStore.save({
      id: projectId,
      createdAt: new Date().toISOString(),
      source: {
        ...video,
        relativePath: path.posix.join(
          "storage",
          "uploads",
          projectId,
          storedName,
        ),
      },
    });

    return NextResponse.json({ video });
  } catch (error) {
    await rm(uploadDir, { recursive: true, force: true });

    if (error instanceof VideoProcessingError) {
      const status = error.code === "FFPROBE_NOT_FOUND" ? 503 : 422;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        { status },
      );
    }

    console.error("Video analysis failed", error);
    return NextResponse.json(
      { error: "No se pudo analizar el video." },
      { status: 500 },
    );
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}
