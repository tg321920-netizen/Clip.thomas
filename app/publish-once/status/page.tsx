"use client";

import { useEffect, useState } from "react";

type JobStatus = {
  status: string;
  stage: string;
  progress: number;
  title?: string | null;
  duration?: number | null;
  externalPostUrl?: string | null;
  error?: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  IDLE: "Esperando iniciar la prueba",
  QUEUED: "Trabajo en cola",
  STARTING: "Iniciando ClipForge",
  CHECKING_YOUTUBE_CONNECTION: "Verificando YouTube",
  DISCOVERING_POPULAR_CC_VIDEOS: "Buscando videos populares reutilizables",
  SOURCE_SELECTED: "Fuente seleccionada",
  DOWNLOADING_SOURCE: "Preparando el video fuente",
  USING_VERIFIED_CC_FALLBACK: "Usando fuente Creative Commons verificada",
  TRANSCRIBING: "Transcribiendo el video",
  ANALYZING_HIGHLIGHTS: "Buscando el mejor fragmento",
  GENERATING_SUBTITLES: "Generando subtítulos",
  APPLYING_SMOOTH_ZOOM: "Aplicando encuadre y zoom suave",
  RENDERING: "Editando y renderizando el clip",
  CREATING_TITLE_AND_METADATA: "Creando título y descripción",
  UPLOADING_TO_YOUTUBE: "Subiendo a YouTube",
  YOUTUBE_PROCESSING: "YouTube está procesando el video",
  PUBLISHED: "Publicado",
  FAILED: "La prueba encontró un error",
  START_FAILED: "No se pudo iniciar la autorización",
};

export default function PublishOnceStatusPage() {
  const [job, setJob] = useState<JobStatus>({
    status: "IDLE",
    stage: "IDLE",
    progress: 0,
  });

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch("/api/publish-once/status", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as JobStatus;
        if (active) setJob(data);
      } catch {
        // A temporary network error should not replace the last known status.
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const done = job.status === "PUBLISHED" && Boolean(job.externalPostUrl);
  const failed = job.status === "FAILED";

  return (
    <main className="min-h-screen bg-[#07080b] px-5 py-10 text-zinc-100">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
          ClipForge
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          {done ? "Video listo" : "Prueba completa en proceso"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {STAGE_LABELS[job.stage] || job.stage}
        </p>

        <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-700"
            style={{ width: `${Math.max(2, Math.min(100, job.progress || 0))}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          {Math.round(job.progress || 0)}%
        </p>

        {job.title ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Título</p>
            <p className="mt-2 font-medium text-zinc-100">{job.title}</p>
            {job.duration ? (
              <p className="mt-2 text-sm text-zinc-400">
                Duración: {Math.round(job.duration)} segundos
              </p>
            ) : null}
          </div>
        ) : null}

        {done ? (
          <a
            href={job.externalPostUrl || "#"}
            className="mt-6 block w-full rounded-xl bg-violet-500 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Ver video publicado en YouTube
          </a>
        ) : null}

        {failed ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4">
            <p className="text-sm font-medium text-red-300">La ejecución se detuvo.</p>
            <p className="mt-2 break-words text-xs leading-5 text-red-200/80">
              {job.error || "Error desconocido."}
            </p>
            <a
              href="/api/publish-once/start"
              className="mt-4 block rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-zinc-100"
            >
              Reintentar autorización y prueba
            </a>
          </div>
        ) : null}

        {!done && !failed ? (
          <p className="mt-6 text-xs leading-5 text-zinc-500">
            Podés dejar esta pantalla abierta. Se actualiza sola y ayuda a mantener activo el servicio gratuito mientras procesa el video.
          </p>
        ) : null}
      </div>
    </main>
  );
}
