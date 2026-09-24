"use client";

import { useRef, useState } from "react";
import { LiveCapturePanel } from "@/components/LiveCapturePanel";
import { ProjectPipeline } from "@/components/ProjectPipeline";
import { NewsModePanel } from "@/components/NewsModePanel";
import {
  MAX_UPLOAD_BYTES,
  validateUploadDescriptor,
} from "@/lib/upload-policy.mjs";
import type { UploadedVideo } from "@/types/video";

type State = "idle" | "checking" | "uploading" | "ready" | "error";

export function LiveCaptureWorkspace() {
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadedVideo | null>(null);
  const [capturedName, setCapturedName] = useState<string | null>(null);

  async function handleCaptured(file: File) {
    setCapturedName(file.name);
    setError(null);
    setResult(null);

    const validation = validateUploadDescriptor({
      filename: file.name,
      mimeType: file.type || "video/webm",
      size: file.size,
    });
    if (!validation.ok || file.size > MAX_UPLOAD_BYTES) {
      setState("error");
      setError(validation.error || "La captura supera el límite de subida.");
      return;
    }

    setState("checking");
    try {
      const response = await fetch("/api/system/media-status", { cache: "no-store" });
      const status = (await response.json()) as { ready?: boolean; message?: string };
      if (!response.ok || !status.ready) {
        throw new Error(status.message || "El motor de video no está disponible.");
      }
    } catch (checkError) {
      setState("error");
      setError(
        checkError instanceof Error
          ? checkError.message
          : "No se pudo verificar el motor de video.",
      );
      return;
    }

    setState("uploading");
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/videos/upload");
    xhr.setRequestHeader("Content-Type", file.type || "video/webm");
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
        setState("ready");
        window.dispatchEvent(new Event("clipforge:project-created"));
      } else {
        setError(payload.error || `La subida falló (HTTP ${xhr.status}).`);
        setState("error");
      }
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

  const busy = state === "checking" || state === "uploading";

  return (
    <div className="space-y-5">
      <LiveCapturePanel disabled={busy} onCaptured={(file) => void handleCaptured(file)} />

      {capturedName && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">{capturedName}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {state === "checking" && "Verificando FFmpeg y FFprobe…"}
                {state === "uploading" && "Enviando captura al pipeline…"}
                {state === "ready" && "Captura convertida en proyecto real."}
                {state === "error" && "La captura no pudo entrar al pipeline."}
                {state === "idle" && "Captura lista."}
              </p>
            </div>
            {state === "uploading" && (
              <button
                type="button"
                onClick={() => xhrRef.current?.abort()}
                className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-300"
              >
                Cancelar subida
              </button>
            )}
          </div>

          {state === "uploading" && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Subida real</span>
                <span>{progress === null ? "—" : `${progress}%`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                {progress !== null && (
                  <div
                    className="h-full bg-cyan-500 transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      )}

      {result && (
        <section className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          <div className="aspect-video bg-black">
            <video
              controls
              preload="metadata"
              poster={result.posterUrl}
              src={result.sourceUrl}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Captura procesada
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  {result.width}×{result.height} · {Math.round(result.durationSeconds)} s · {result.codec.toUpperCase()}
                </p>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                PROYECTO REAL
              </span>
            </div>

            <ProjectPipeline projectId={result.projectId} />
            <div className="mt-4">
              <NewsModePanel projectId={result.projectId} enabled />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function parsePayload(value: string): { error?: string; video?: UploadedVideo } {
  try {
    return JSON.parse(value) as { error?: string; video?: UploadedVideo };
  } catch {
    return {};
  }
}
