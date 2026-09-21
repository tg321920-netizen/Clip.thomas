"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentAnalysisRecord } from "@/types/analysis";
import type { ClipRecord } from "@/types/clip";
import type { TranscriptRecord } from "@/types/transcription";

type JobRecord = {
  id: string;
  type: "TRANSCRIBE_VIDEO" | "ANALYZE_VIDEO" | "RENDER_CLIP";
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  attempts: number;
  progress?: number;
  error: string | null;
  nextAttemptAt?: string | null;
};

type ClipWithJob = ClipRecord & {
  job: JobRecord | null;
};

type TranscriptionPayload = {
  transcript: TranscriptRecord | null;
  job: JobRecord | null;
  reused?: boolean;
  error?: string;
};

type AnalysisPayload = {
  analysis: ContentAnalysisRecord | null;
  job: JobRecord | null;
  reused?: boolean;
  error?: string;
};

type ClipsPayload = {
  clips?: ClipWithJob[];
  clip?: ClipRecord;
  job?: JobRecord | null;
  error?: string;
};

export function ProjectPipeline({ projectId }: { projectId: string }) {
  const [transcript, setTranscript] = useState<TranscriptRecord | null>(null);
  const [transcriptionJob, setTranscriptionJob] = useState<JobRecord | null>(
    null,
  );
  const [analysis, setAnalysis] = useState<ContentAnalysisRecord | null>(null);
  const [analysisJob, setAnalysisJob] = useState<JobRecord | null>(null);
  const [clips, setClips] = useState<ClipWithJob[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(
    async (silent = false) => {
      try {
        const [transcriptionResponse, analysisResponse, clipsResponse] =
          await Promise.all([
            fetch(`/api/projects/${projectId}/transcription`, {
              cache: "no-store",
            }),
            fetch(`/api/projects/${projectId}/analysis`, {
              cache: "no-store",
            }),
            fetch(`/api/projects/${projectId}/clips`, {
              cache: "no-store",
            }),
          ]);

        if (!transcriptionResponse.ok) {
          throw new Error("No se pudo consultar la transcripción.");
        }
        if (!analysisResponse.ok) {
          throw new Error("No se pudo consultar el análisis.");
        }
        if (!clipsResponse.ok) {
          throw new Error("No se pudieron consultar los clips.");
        }

        const transcriptionData =
          (await transcriptionResponse.json()) as TranscriptionPayload;
        const analysisData = (await analysisResponse.json()) as AnalysisPayload;
        const clipsData = (await clipsResponse.json()) as ClipsPayload;

        setTranscript(transcriptionData.transcript);
        setTranscriptionJob(transcriptionData.job);
        setAnalysis(analysisData.analysis);
        setAnalysisJob(analysisData.job);
        setClips(clipsData.clips ?? []);
        if (!silent) setError(null);
      } catch (loadError) {
        if (!silent) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudo consultar el procesamiento.",
          );
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadState();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadState]);

  const processing = useMemo(
    () =>
      transcriptionJob?.status === "QUEUED" ||
      transcriptionJob?.status === "PROCESSING" ||
      analysisJob?.status === "QUEUED" ||
      analysisJob?.status === "PROCESSING" ||
      clips.some(
        (clip) =>
          clip.job?.status === "QUEUED" || clip.job?.status === "PROCESSING",
      ),
    [analysisJob?.status, clips, transcriptionJob?.status],
  );

  useEffect(() => {
    if (!processing) return;

    const timer = window.setInterval(() => {
      void loadState(true);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [loadState, processing]);

  async function queueTranscription() {
    setLoadingAction("transcription");
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/transcription`,
        { method: "POST" },
      );
      const payload = (await response.json()) as TranscriptionPayload;

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo iniciar la transcripción.");
      }

      setTranscript(payload.transcript);
      setTranscriptionJob(payload.job);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo iniciar la transcripción.",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  async function queueAnalysis() {
    setLoadingAction("analysis");
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          minDuration: 15,
          maxDuration: 60,
          targetDuration: 30,
          maxCandidates: 10,
        }),
      });
      const payload = (await response.json()) as AnalysisPayload;

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo iniciar el análisis.");
      }

      setAnalysis(payload.analysis);
      setAnalysisJob(payload.job);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo iniciar el análisis.",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  async function queueClip(candidateId: string) {
    const action = `clip:${candidateId}`;
    setLoadingAction(action);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/clips`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          candidateId,
          framingMode: "FILL",
          quality: "BALANCED",
        }),
      });
      const payload = (await response.json()) as ClipsPayload;

      if (!response.ok) {
        throw new Error(payload.error || "No se pudo preparar el clip.");
      }

      await loadState(true);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo preparar el clip.",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  const transcriptionDone = transcript?.status === "COMPLETED";
  const analysisDone = analysis?.status === "COMPLETED";

  return (
    <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">
              Paso 2
            </p>
            <h4 className="mt-1 font-medium text-zinc-100">Transcripción</h4>
          </div>
          <StatusBadge
            status={
              transcript?.status ||
              transcriptionJob?.status ||
              "PENDING"
            }
          />
        </div>

        {transcriptionDone ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
              <span>{transcript.segments.length} segmentos</span>
              <span>·</span>
              <span>{transcript.language || "idioma autodetectado"}</span>
              <span>·</span>
              <span>{transcript.model}</span>
            </div>

            <div className="mt-3 max-h-36 space-y-2 overflow-auto rounded-xl bg-black/30 p-3 text-xs leading-5 text-zinc-400">
              {transcript.segments.slice(0, 4).map((segment) => (
                <p key={segment.id}>
                  <span className="mr-2 font-mono text-zinc-600">
                    {formatTime(segment.startTime)}
                  </span>
                  {segment.text}
                </p>
              ))}
              {transcript.segments.length > 4 && (
                <p className="text-zinc-600">
                  + {transcript.segments.length - 4} segmentos más
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Whisper extrae el audio y crea segmentos reales con timestamps.
            {transcriptionJob?.status === "QUEUED" &&
              " El trabajo está esperando al worker de transcripción."}
          </p>
        )}

        {!transcriptionDone && (
          <button
            type="button"
            onClick={() => void queueTranscription()}
            disabled={
              loadingAction !== null ||
              transcriptionJob?.status === "QUEUED" ||
              transcriptionJob?.status === "PROCESSING"
            }
            className="mt-4 w-full rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingAction === "transcription"
              ? "Encolando…"
              : transcriptionJob?.status === "QUEUED"
                ? "Esperando worker…"
                : transcriptionJob?.status === "PROCESSING"
                  ? "Transcribiendo…"
                  : "Transcribir con Whisper"}
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">
              Paso 3
            </p>
            <h4 className="mt-1 font-medium text-zinc-100">
              Momentos candidatos
            </h4>
          </div>
          <StatusBadge
            status={analysis?.status || analysisJob?.status || "PENDING"}
          />
        </div>

        {!transcriptionDone ? (
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Este paso se habilita cuando Whisper termina la transcripción.
          </p>
        ) : analysisDone ? (
          <>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
              <span>{analysis.candidates.length} candidatos</span>
              <span>{analysis.provider}</span>
            </div>

            <div className="mt-3 space-y-3">
              {analysis.candidates.slice(0, 5).map((candidate) => {
                const clip = clips.find(
                  (entry) => entry.candidateId === candidate.id,
                );
                const clipBusy =
                  clip?.job?.status === "QUEUED" ||
                  clip?.job?.status === "PROCESSING";
                const clipProgress = Math.max(
                  0,
                  Math.min(100, Number(clip?.job?.progress || 0)),
                );

                return (
                  <article
                    key={candidate.id}
                    className="rounded-xl border border-white/10 bg-white/[0.035] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h5 className="text-sm font-medium text-zinc-200">
                          {candidate.title}
                        </h5>
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatTime(candidate.startTime)} –{" "}
                          {formatTime(candidate.endTime)} ·{" "}
                          {Math.round(candidate.duration)} s
                        </p>
                      </div>
                      <div className="shrink-0 rounded-xl bg-violet-500/15 px-3 py-2 text-center">
                        <div className="text-lg font-semibold text-violet-300">
                          {candidate.viralScore}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-violet-400/70">
                          ViralScore
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-5 text-zinc-400">
                      <span className="font-medium text-zinc-300">Hook:</span>{" "}
                      {candidate.hook}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {candidate.reasons[0] || candidate.reason}
                    </p>

                    {clip?.status === "READY" && clip.render ? (
                      <div className="mt-3">
                        <video
                          controls
                          preload="metadata"
                          src={clip.render.sourceUrl}
                          className="mx-auto max-h-[420px] w-full rounded-xl bg-black object-contain"
                        >
                          Tu navegador no puede reproducir este clip.
                        </video>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-400">
                          <span>Clip 1080×1920 listo</span>
                          <span>{clip.edit.quality}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        {clipBusy && (
                          <div className="mt-3">
                            <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                              <span>
                                {clip?.job?.status === "QUEUED"
                                  ? "Esperando worker de render…"
                                  : "Renderizando clip real…"}
                              </span>
                              <span>{Math.round(clipProgress)}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full bg-violet-500 transition-[width]"
                                style={{ width: `${clipProgress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => void queueClip(candidate.id)}
                          disabled={
                            loadingAction !== null ||
                            clipBusy
                          }
                          className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {loadingAction === `clip:${candidate.id}`
                            ? "Encolando render…"
                            : clip?.status === "FAILED"
                              ? "Reintentar clip 9:16"
                              : clipBusy
                                ? "Procesando…"
                                : "Crear clip 9:16"}
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
            </div>

            <p className="mt-3 text-[11px] leading-5 text-zinc-600">
              ViralScore es una estimación interna, no una garantía de
              rendimiento.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Genera ventanas de 15–60 segundos sobre los segmentos reales y
              puntúa las señales disponibles sin inventar energía de audio.
              {analysisJob?.status === "QUEUED" &&
                " El trabajo está esperando al worker de análisis."}
            </p>
            <button
              type="button"
              onClick={() => void queueAnalysis()}
              disabled={
                loadingAction !== null ||
                analysisJob?.status === "QUEUED" ||
                analysisJob?.status === "PROCESSING"
              }
              className="mt-4 w-full rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loadingAction === "analysis"
                ? "Encolando…"
                : analysisJob?.status === "QUEUED"
                  ? "Esperando worker…"
                  : analysisJob?.status === "PROCESSING"
                    ? "Analizando…"
                    : "Encontrar mejores momentos"}
            </button>
          </>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const done = normalized === "COMPLETED";
  const failed = normalized === "FAILED";
  const active = normalized === "QUEUED" || normalized === "PROCESSING";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        done
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : failed
            ? "border-red-400/20 bg-red-400/10 text-red-300"
            : active
              ? "border-violet-400/20 bg-violet-400/10 text-violet-300"
              : "border-white/10 bg-white/5 text-zinc-500"
      }`}
    >
      {labelStatus(normalized)}
    </span>
  );
}

function labelStatus(status: string): string {
  if (status === "QUEUED") return "En cola";
  if (status === "PROCESSING") return "Procesando";
  if (status === "COMPLETED") return "Listo";
  if (status === "FAILED") return "Falló";
  return "Pendiente";
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
