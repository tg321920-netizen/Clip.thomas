"use client";

import { useState } from "react";
import type { UploadedVideo } from "@/types/video";
import { ProjectPipeline } from "@/components/ProjectPipeline";

export function StreamCapturePanel() {
  const [url, setUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadedVideo | null>(null);

  async function capture() {
    const cleanUrl = url.trim();
    if (!cleanUrl || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/streams/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cleanUrl, durationSeconds }),
      });
      const payload = (await response.json()) as {
        video?: UploadedVideo;
        error?: string;
      };
      if (!response.ok || !payload.video) {
        throw new Error(payload.error || `La captura falló (HTTP ${response.status}).`);
      }

      setResult(payload.video);
      window.dispatchEvent(new Event("clipforge:project-created"));
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "No se pudo capturar el stream.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-cyan-400/15 bg-cyan-400/[0.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            Streaming · entrada directa
          </p>
          <h2 className="mt-2 text-xl font-semibold">Captura un tramo de un stream real</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Pega una URL directa HLS (.m3u8), HTTP(S), RTMP o RTMPS. El servidor usa FFmpeg
            para grabar el tramo y lo convierte en un proyecto normal de ClipForge.
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/15 px-3 py-1 text-xs text-cyan-200/80">
          SERVIDOR
        </span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_150px_auto]">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://.../live.m3u8 o rtmp://..."
          disabled={busy}
          className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
        />
        <label className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-500">
          Segundos
          <input
            type="number"
            min={5}
            max={120}
            value={durationSeconds}
            onChange={(event) =>
              setDurationSeconds(
                Math.max(5, Math.min(120, Math.round(Number(event.target.value) || 30))),
              )
            }
            disabled={busy}
            className="mt-1 w-full bg-transparent text-base font-semibold text-zinc-200 outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void capture()}
          disabled={busy || !url.trim()}
          className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Capturando…" : "● CAPTURAR STREAM"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-5 text-zinc-600">
        Una URL normal de la página de YouTube, Twitch o TikTok no siempre es el stream de video.
        Para esas plataformas se necesita su API o resolver la URL multimedia antes de enviarla aquí.
      </p>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-200">Stream guardado como proyecto real</p>
              <p className="mt-1 break-all text-xs text-zinc-500">{result.projectId}</p>
            </div>
            <span className="text-xs text-emerald-400">{result.width}×{result.height}</span>
          </div>
          <ProjectPipeline projectId={result.projectId} />
        </div>
      ) : null}
    </section>
  );
}
