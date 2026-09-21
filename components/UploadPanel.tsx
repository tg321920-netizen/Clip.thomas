"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  MAX_UPLOAD_BYTES,
  validateUploadDescriptor,
} from "@/lib/upload-policy.mjs";
import type { UploadedVideo } from "@/types/video";\nimport { ProjectPipeline } from "@/components/ProjectPipeline";

type UploadState = "idle" | "checking" | "uploading" | "done" | "error";

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<UploadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;

    const validation = validateUploadDescriptor({
      filename: nextFile.name,
      mimeType: nextFile.type || "application/octet-stream",
      size: nextFile.size,
    });

    setFile(nextFile);
    setResult(null);
    setProgress(null);

    if (!validation.ok) {
      setError(validation.error ?? "El archivo no es válido.");
      setState("error");
      return;
    }

    setError(null);
    setState("idle");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function upload() {
    if (!file || state === "checking" || state === "uploading" || error) return;

    setState("checking");
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const readinessResponse = await fetch("/api/system/media-status", {
        cache: "no-store",
      });
      const readiness = (await readinessResponse.json()) as {
        ready?: boolean;
        message?: string;
      };

      if (!readiness.ready) {
        setError(
          readiness.message ||
            "Este entorno todavía no está listo para procesar video.",
        );
        setState("error");
        return;
      }
    } catch {
      setError("No se pudo verificar el motor de procesamiento.");
      setState("error");
      return;
    }

    setState("uploading");
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/videos/upload");
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-File-Size", String(file.size));

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        setProgress(null);
        return;
      }
      setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      xhrRef.current = null;
      const payload = parsePayload(xhr.responseText);

      if (xhr.status >= 200 && xhr.status < 300 && payload.video) {
        setProgress(100);
        setResult(payload.video);
        setState("done");
        window.dispatchEvent(new Event("clipforge:project-created"));
        return;
      }

      setError(payload.error || `La subida falló (HTTP ${xhr.status}).`);
      setState("error");
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setError("No se pudo conectar con el servidor.");
      setState("error");
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      setError("Subida cancelada.");
      setState("error");
    };

    xhr.send(file);
  }

  function cancel() {
    xhrRef.current?.abort();
  }

  const busy = state === "checking" || state === "uploading";

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 sm:p-6">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-2xl border border-dashed p-6 text-center transition sm:p-8 ${
          dragging
            ? "border-violet-400 bg-violet-500/10"
            : "border-white/15 bg-black/20"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-2xl text-violet-300">
          ↑
        </div>
        <h2 className="mt-4 text-lg font-medium">Sube tu video</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          MP4, MOV o WebM · máximo {formatBytes(MAX_UPLOAD_BYTES)}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-5 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Elegir archivo
        </button>
      </div>

      {file && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-200">{file.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{formatBytes(file.size)}</p>
            </div>
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
              {extensionOf(file.name)}
            </span>
          </div>

          {state === "checking" && (
            <p className="mt-4 text-xs text-violet-300">
              Verificando FFmpeg, FFprobe y almacenamiento…
            </p>
          )}

          {state === "uploading" && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                <span>{progress === null ? "Subiendo…" : "Subida real"}</span>
                <span>{progress === null ? "—" : `${progress}%`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                {progress !== null && (
                  <div
                    className="h-full rounded-full bg-violet-500 transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {!busy ? (
              <button
                type="button"
                onClick={() => void upload()}
                disabled={Boolean(error)}
                className="flex-1 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Analizar video real
              </button>
            ) : state === "uploading" ? (
              <button
                type="button"
                onClick={cancel}
                className="flex-1 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-sm font-medium text-red-300"
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="flex-1 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-sm font-medium text-violet-200 opacity-70"
              >
                Verificando entorno…
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07]">
          <div className="aspect-video w-full bg-black">
            <video
              controls
              preload="metadata"
              poster={result.posterUrl}
              src={result.sourceUrl}
              className="h-full w-full object-contain"
            >
              Tu navegador no puede reproducir este video.
            </video>
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-emerald-200">
                FFprobe + FFmpeg completados
              </h3>
              <span className="text-xs text-emerald-400">REAL</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              El reproductor usa el archivo que acabas de subir, no una demo.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Metric label="Duración" value={formatDuration(result.durationSeconds)} />
              <Metric label="Resolución" value={`${result.width}×${result.height}`} />
              <Metric label="FPS" value={String(result.fps)} />
              <Metric label="Códec" value={result.codec.toUpperCase()} />
              <Metric label="Aspecto" value={result.aspectRatio} />
              <Metric label="Contenedor" value={result.container.toUpperCase()} />
            </dl>
            <p className="mt-4 break-all text-[11px] text-zinc-500">
              Proyecto: {result.projectId}
            </p>

            <ProjectPipeline projectId={result.projectId} />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/20 p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium text-zinc-200">{value}</dd>
    </div>
  );
}

function parsePayload(value: string): {
  error?: string;
  video?: UploadedVideo;
} {
  try {
    return JSON.parse(value) as { error?: string; video?: UploadedVideo };
  } catch {
    return {};
  }
}

function extensionOf(name: string): string {
  return name.split(".").pop()?.toUpperCase() || "VIDEO";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
