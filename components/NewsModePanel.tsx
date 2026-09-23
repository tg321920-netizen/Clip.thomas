"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewsBrief, NewsTemplate } from "@/types/news";

type JobRecord = {
  id: string;
  type: "RENDER_NEWS";
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress?: number;
  error: string | null;
};

type NewsPayload = {
  newsBrief: NewsBrief | null;
  job: JobRecord | null;
  reused?: boolean;
  error?: string;
};

export function NewsModePanel({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const [brief, setBrief] = useState<NewsBrief | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [template, setTemplate] = useState<NewsTemplate | "AUTO">("AUTO");
  const [busy, setBusy] = useState<"prepare" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!enabled) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/news`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as NewsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo consultar News Mode.");
      }

      setBrief(payload.newsBrief);
      setJob(payload.job);
      if (!silent) setError(null);
    } catch (loadError) {
      if (!silent) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo consultar News Mode.",
        );
      }
    }
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, load]);

  const rendering =
    job?.status === "QUEUED" || job?.status === "PROCESSING";

  useEffect(() => {
    if (!rendering) return;

    const timer = window.setInterval(() => {
      void load(true);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [load, rendering]);

  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));

  const posterUrl = useMemo(
    () => `/api/projects/${projectId}/poster`,
    [projectId],
  );

  async function prepare() {
    setBusy("prepare");
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          targetWords: 90,
          ...(template !== "AUTO" ? { template } : {}),
        }),
      });
      const payload = (await response.json()) as NewsPayload;

      if (!response.ok || !payload.newsBrief) {
        throw new Error(payload.error || "No se pudo preparar el resumen.");
      }

      setBrief(payload.newsBrief);
      setJob(payload.job);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo preparar el resumen.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function render() {
    setBusy("render");
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "render" }),
      });
      const payload = (await response.json()) as NewsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo iniciar el video narrado.");
      }

      setBrief(payload.newsBrief);
      setJob(payload.job);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo iniciar el video narrado.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!enabled) {
    return (
      <section className="rounded-2xl border border-white/10 bg-black/20 p-4 opacity-60">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">
          Modo Noticias
        </p>
        <h4 className="mt-1 font-medium text-zinc-100">
          Resumen narrado con plantilla
        </h4>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Se habilita cuando Whisper termina la transcripción.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">
            Modo Noticias
          </p>
          <h4 className="mt-1 font-medium text-zinc-100">
            Resumen + voz + imagen + plantilla
          </h4>
          <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-500">
            El resumen es extractivo: usa únicamente frases presentes en la
            transcripción para no inventar datos.
          </p>
        </div>

        <select
          value={template}
          onChange={(event) =>
            setTemplate(event.target.value as NewsTemplate | "AUTO")
          }
          disabled={busy !== null || rendering}
          className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300"
        >
          <option value="AUTO">Plantilla automática</option>
          <option value="BREAKING">URGENTE</option>
          <option value="CLEAN">LIMPIA</option>
          <option value="TECH">TECNOLOGÍA</option>
          <option value="SPORTS">DEPORTES</option>
          <option value="ECONOMY">ECONOMÍA</option>
        </select>
      </div>

      {!brief ? (
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={busy !== null}
          className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-40"
        >
          {busy === "prepare" ? "Preparando resumen…" : "Crear resumen de noticia"}
        </button>
      ) : (
        <div className="mt-4 space-y-4">
          <div
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-4"
            style={{
              backgroundImage: `linear-gradient(rgba(9,9,11,.72), rgba(9,9,11,.92)), url(${posterUrl})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }}
          >
            <div className="relative">
              <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
                <span>{brief.category}</span>
                <span>{brief.template}</span>
              </div>

              <h5 className="mt-3 text-lg font-semibold leading-tight text-white">
                {brief.headline}
              </h5>
              <p className="mt-3 text-xs leading-5 text-zinc-300">
                {brief.summary}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {brief.keyPoints.slice(0, 3).map((point, index) => (
                  <span
                    key={`${index}:${point}`}
                    className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] text-zinc-300"
                  >
                    {point}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Guion de narración
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-300">
              {brief.narration}
            </p>
            <p className="mt-2 text-[10px] leading-4 text-zinc-600">
              {brief.disclaimer}
            </p>
          </div>

          {brief.status === "RENDERED" && brief.render ? (
            <div>
              <video
                controls
                preload="metadata"
                src={brief.render.sourceUrl}
                className="mx-auto max-h-[520px] w-full rounded-xl bg-black object-contain"
              >
                Tu navegador no puede reproducir este video.
              </video>
              <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-400">
                <span>News video 1080×1920 listo</span>
                <span>{brief.render.ttsProvider}</span>
              </div>
            </div>
          ) : (
            <>
              {rendering && (
                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                    <span>
                      {job?.status === "QUEUED"
                        ? "Esperando worker de noticias…"
                        : "Generando voz y video…"}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-sky-500 transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void render()}
                disabled={busy !== null || rendering}
                className="w-full rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-200 transition hover:bg-sky-400/15 disabled:opacity-40"
              >
                {busy === "render"
                  ? "Encolando render…"
                  : brief.status === "FAILED"
                    ? "Reintentar video narrado"
                    : rendering
                      ? "Procesando…"
                      : "Generar video narrado 9:16"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void prepare()}
            disabled={busy !== null || rendering}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-40"
          >
            Regenerar resumen con la plantilla elegida
          </button>
        </div>
      )}

      {(error || job?.error) && (
        <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-200">
          {error || job?.error}
        </p>
      )}
    </section>
  );
}
