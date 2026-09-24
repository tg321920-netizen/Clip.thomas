"use client";

import { useEffect, useRef, useState } from "react";

type CaptureState = "idle" | "requesting" | "recording" | "finalizing";

export function LiveCapturePanel({
  disabled = false,
  onCaptured,
}: {
  disabled?: boolean;
  onCaptured: (file: File) => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const [state, setState] = useState<CaptureState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioIncluded, setAudioIncluded] = useState<boolean | null>(null);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    return () => stopTracks();
  }, []);

  async function startCapture() {
    if (disabled || state !== "idle") return;
    setState("requesting");
    setError(null);
    setElapsed(0);
    setAudioIncluded(null);
    chunksRef.current = [];

    try {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
        throw new Error(
          "Este navegador no permite captura de pantalla con MediaRecorder.",
        );
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: true,
      });
      streamRef.current = stream;
      setAudioIncluded(stream.getAudioTracks().length > 0);

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        try {
          setState("finalizing");
          const type = recorder.mimeType || mimeType || "video/webm";
          const blob = new Blob(chunksRef.current, { type });
          if (blob.size <= 0) {
            throw new Error("La captura terminó sin datos de video.");
          }

          const stamp = new Date().toISOString().replaceAll(":", "-");
          const file = new File([blob], `live-capture-${stamp}.webm`, {
            type: type.startsWith("video/") ? type : "video/webm",
            lastModified: Date.now(),
          });
          onCaptured(file);
          setError(null);
        } catch (captureError) {
          setError(
            captureError instanceof Error
              ? captureError.message
              : "No se pudo finalizar la captura.",
          );
        } finally {
          recorderRef.current = null;
          chunksRef.current = [];
          stopTracks();
          startedAtRef.current = null;
          setState("idle");
        }
      });

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener("ended", () => {
        if (recorder.state === "recording") recorder.stop();
      });

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setState("recording");
    } catch (captureError) {
      stopTracks();
      recorderRef.current = null;
      setState("idle");
      const name = captureError instanceof DOMException ? captureError.name : "";
      setError(
        name === "NotAllowedError"
          ? "La captura fue cancelada o el navegador no recibió permiso para compartir la pantalla."
          : captureError instanceof Error
            ? captureError.message
            : "No se pudo iniciar la captura.",
      );
    }
  }

  function stopCapture() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setState("finalizing");
    recorder.stop();
  }

  function stopTracks() {
    for (const track of streamRef.current?.getTracks() || []) track.stop();
    streamRef.current = null;
  }

  const busy = state !== "idle";

  return (
    <div className="mb-4 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.045] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Captura manual de LIVE
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Elige una pestaña o ventana, marca inicio y final. El navegador siempre pide permiso visible.
          </p>
        </div>
        {state === "recording" && (
          <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-xs font-medium text-red-300">
            ● REC {formatTime(elapsed)}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void startCapture()}
          disabled={disabled || busy}
          className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "requesting" ? "Esperando permiso…" : "Comenzar captura"}
        </button>
        <button
          type="button"
          onClick={stopCapture}
          disabled={state !== "recording"}
          className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {state === "finalizing" ? "Finalizando…" : "Terminar captura"}
        </button>
      </div>

      {audioIncluded !== null && state === "recording" && (
        <p className="mt-2 text-[11px] text-zinc-600">
          {audioIncluded
            ? "Audio de la fuente incluido por el navegador."
            : "La fuente compartida no entregó pista de audio; el clip quedará sin audio."}
        </p>
      )}
      {error && <p className="mt-2 text-xs leading-5 text-red-300">{error}</p>}
    </div>
  );
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
