import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-policy.mjs";
import { ProjectStore } from "@/services/ProjectStore";
import { getStorageRoot } from "@/services/StorageService";
import { VideoProcessor } from "@/services/VideoProcessor";
import type { UploadedVideo } from "@/types/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const videoProcessor = new VideoProcessor();
const projectStore = new ProjectStore();
const MAX_CAPTURE_SECONDS = 120;
const MIN_CAPTURE_SECONDS = 5;

export async function POST(request: Request) {
  const body = await safeJson(request);
  const rawUrl = String(body.url || "").trim();
  const durationSeconds = clampDuration(body.durationSeconds);

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "La URL del stream no es válida." }, { status: 400 });
  }

  if (!["http:", "https:", "rtmp:", "rtmps:"].includes(sourceUrl.protocol)) {
    return NextResponse.json(
      { error: "Usa una URL directa HTTP(S), HLS (.m3u8), RTMP o RTMPS." },
      { status: 400 },
    );
  }

  try {
    await assertPublicHost(sourceUrl.hostname);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Host de streaming no permitido." },
      { status: 400 },
    );
  }

  const projectId = randomUUID();
  const videoId = randomUUID();
  const storageRoot = getStorageRoot();
  const uploadDir = path.join(storageRoot, "uploads", projectId);
  const filePath = path.join(uploadDir, "source.mp4");
  const posterPath = path.join(uploadDir, "poster.jpg");

  try {
    await mkdir(uploadDir, { recursive: true });

    await captureStream(rawUrl, filePath, durationSeconds);
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size <= 0) {
      throw new Error("FFmpeg terminó sin generar video.");
    }
    if (fileStats.size > MAX_UPLOAD_BYTES) {
      throw new Error("La captura superó el límite de 1 GB.");
    }

    const technical = await videoProcessor.probe(filePath);
    const posterSeek = Math.min(1, technical.durationSeconds / 2);
    await videoProcessor.createPoster(filePath, posterPath, posterSeek);

    const video: UploadedVideo = {
      projectId,
      videoId,
      originalName: `stream-${sourceUrl.hostname}-${Date.now()}.mp4`,
      storedName: "source.mp4",
      sizeBytes: fileStats.size,
      posterUrl: `/api/projects/${projectId}/poster`,
      sourceUrl: `/api/projects/${projectId}/source`,
      ...technical,
    };

    await projectStore.save({
      id: projectId,
      createdAt: new Date().toISOString(),
      source: {
        ...video,
        relativePath: path.posix.join("uploads", projectId, "source.mp4"),
      },
    });

    return NextResponse.json({ video }, { status: 201 });
  } catch (error) {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    console.error("Stream capture failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo capturar el stream.",
      },
      { status: 422 },
    );
  }
}

function captureStream(url: string, output: string, durationSeconds: number) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,rtmp,rtmps",
    "-i",
    url,
    "-t",
    String(durationSeconds),
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    output,
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 12000) stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("La captura del stream excedió el tiempo permitido."));
    }, (durationSeconds + 30) * 1000);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`No se pudo iniciar FFmpeg: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `FFmpeg no pudo leer ese stream. ${stderr.trim().slice(-1200) || `Código ${code}`}`,
        ),
      );
    });
  });
}

async function assertPublicHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || normalized === "localhost" || normalized.endsWith(".local")) {
    throw new Error("No se permiten direcciones locales o internas.");
  }

  if (isIP(normalized)) {
    if (isPrivateAddress(normalized)) {
      throw new Error("No se permiten direcciones IP privadas o locales.");
    }
    return;
  }

  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("El host debe resolver a una dirección pública.");
  }
}

function isPrivateAddress(address: string) {
  const value = address.toLowerCase();
  if (value === "::1" || value === "0.0.0.0" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));

  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function clampDuration(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(MIN_CAPTURE_SECONDS, Math.min(MAX_CAPTURE_SECONDS, parsed));
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
