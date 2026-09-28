"use client";

import { useState } from "react";
import type { UploadedVideo } from "@/types/video";
import { ProjectPipeline } from "@/components/ProjectPipeline";

type IngestMode = "IMPORT" | "STREAM";
type IngestJob = {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  stage?: string;
  progress?: number;
  error?: string | null;
  result?: { video?: UploadedVideo } | null;
};

export function StreamCapturePanel() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<IngestMode>("IMPORT");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadedVideo | null>(null);
  const [job, setJob] = useState<IngestJob | null>(null);

  async function startIngest() {
    const cleanUrl = url.trim();
    if (!cleanUrl || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setJob(null);

    try {
      const response = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanUrl,
          mode,
          ...(mode === "STREAM" ? { captureSeconds: durationSeconds } : {}),
        }),
      });
      const payload = (await response.json()) as {
        job?: IngestJob;
        error?: string;
      };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || `La ingesta falló (HTTP ${response.status}).`);
      }

      setJob(payload.job);
      await pollJob(payload.job.id);
    } catch (ingestError) {
      setError(
        ingestError instanceof Error
          ? ingestError.message
          : "No se pudo iniciar la ingesta.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pollJob(jobId: string) {
    // The server job is persistent relative to CLIPFORGE_STORAGE_DIR; this loop
    // is only a UI observer. Closing the tab does not cancel the server worker.
    for (;;) {
      const response = await fetch(`/api/ingest/url/${jobId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        job?: IngestJob;
        error?: string;
      };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "No se pudo consultar la ingesta.");
      }

      setJob(payload.job);
      if (payload.job.status === "COMPLETED") {
        const video = payload.job.result?.video;
        if (!video) throw new Error("La ingesta terminó sin datos del video.");
        setResult(video);
        window.dispatchEvent(new Event("clipforge:project-created"));
        return;
      }
      if (payload.job.status === "FAILED") {
        throw new Error(payload.job.error || "La ingesta falló.");
      }

      await sleep(2000);
    }
  }

  async function retryJob() {
    if (!job || job.status !== "FAILED" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ingest/url/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RETRY" }),
      });
      const payload = (await response.json()) as { job?: IngestJob; error?: string };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "No se pudo reintentar la ingesta.");
      }
      setJob(payload.job);
      await pollJob(payload.job.id);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "No se pudo reintentar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-cyan-400/15 bg-cyan-400/[0.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            URL · VIDEO · STREAM
          </p>
          <h2 className="mt-2 text-xl font-semibold">Importa un video o captura un stream real</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Una URL normal compatible se resuelve en el servidor. Para streams largos,
            la captura se guarda por segmentos y continúa como trabajo de fondo aunque
            cierres esta pestaña.
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/15 px-3 py-1 text-xs text-cyan-200/80">
          SERVIDOR
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
        <button
          type="button"
          onClick={() => setMode("IMPORT")}
          disabled={busy}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            mode === "IMPORT" ? "bg-cyan-500 text-black" : "text-zinc-400"
          }`}
        >
          Importar video completo
        </button>
        <button
          type="button"
          onClick={() => setMode("STREAM")}
          disabled={busy}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            mode === "STREAM" ? "bg-cyan-500 text-black" : "text-zinc-400"
          }`}
        >
          Capturar stream
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={
            mode === "IMPORT"
              ? "https://youtube.com/watch?... o URL directa compatible"
              : "https://.../live.m3u8 o rtmp://..."
          }
          disabled={busy}
          className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
        />

        {mode === "STREAM" ? (
          <label className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-500">
            Segundos a capturar
            <input
              type="number"
              min={5}
              max={86400}
              value={durationSeconds}
              onChange={(event) =>
                setDurationSeconds(
                  Math.max(5, Math.min(86400, Math.round(Number(event.target.value) || 30))),
                )
              }
              disabled={busy}
              className="mt-1 w-full min-w-28 bg-transparent text-base font-semibold text-zinc-200 outline-none"
            />
          </label>
        ) : null}

        <button
          type="button"
          onClick={() => void startIngest()}
          disabled={busy || !url.trim()}
          className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? mode === "STREAM"
              ? "Capturando…"
              : "Importando…"
            : mode === "STREAM"
              ? "● CAPTURAR STREAM"
              : "↓ IMPORTAR URL"}
        </button>
      </div>

      {job ? (
        <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-cyan-200">
              {humanStage(job.stage || job.status)}
            </span>
            <span className="tabular-nums text-zinc-400">{Math.round(job.progress || 0)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-cyan-400 transition-[width] duration-500"
              style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }}
            />
          </div>
          <p className="mt-2 break-all text-[11px] text-zinc-600">Job {job.id}</p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          <p>{error}</p>
          {job?.status === "FAILED" ? (
            <button
              type="button"
              onClick={() => void retryJob()}
              disabled={busy}
              className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-xs font-semibold"
            >
              Reintentar trabajo
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-200">Fuente guardada como proyecto real</p>
              <p className="mt-1 break-all text-xs text-zinc-500">{result.projectId}</p>
            </div>
            <span className="text-xs text-emerald-400">
              {result.width}×{result.height} · {Math.round(result.durationSeconds)} s
            </span>
          </div>
          <ProjectPipeline projectId={result.projectId} />
        </div>
      ) : null}
    </section>
  );
}

function humanStage(stage: string) {
  const labels: Record<string, string> = {
    QUEUED: "En cola",
    VALIDATING: "Validando fuente",
    DOWNLOADING: "Descargando video",
    DOWNLOADED: "Descarga terminada",
    CAPTURING_STREAM: "Capturando stream por segmentos",
    MERGING_SEGMENTS: "Uniendo segmentos",
    PROBING: "Leyendo metadatos",
    FINALIZING: "Guardando proyecto",
    RETRY_WAIT: "Esperando reintento",
    RECOVERED: "Recuperado después de interrupción",
    COMPLETED: "Listo",
    FAILED: "Falló",
  };
  return labels[stage] || stage;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
