"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES, validateUploadDescriptor } from "@/lib/upload-policy.mjs";
import type { UploadedVideo } from "@/types/video";
import { ProjectPipeline } from "@/components/ProjectPipeline";

type CaptureState =
  | "idle"
  | "requesting"
  | "recording"
  | "ready"
  | "uploading"
  | "done"
  | "error";

type CaptureSource = "screen" | "camera";

export function ManualLiveCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [state, setState] = useState<CaptureState>("idle");
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<UploadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autopilotMessage, setAutopilotMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopTracks(streamRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const recorderSupported = typeof MediaRecorder !== "undefined";
  const screenSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia) &&
    recorderSupported;
  const cameraSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    recorderSupported;
  const supported = screenSupported || cameraSupported;

  async function startCapture(nextSource: CaptureSource) {
    if (!supported || state === "recording" || state === "requesting") return;
    if (nextSource === "screen" && !screenSupported) return;
    if (nextSource === "camera" && !cameraSupported) return;

    setError(null);
    setAutopilotMessage(null);
    setResult(null);
    setFile(null);
    setSource(nextSource);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setState("requesting");

    try {
      const stream =
        nextSource === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: "environment" } },
              audio: true,
            });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError("La grabación del navegador reportó un error.");
        setState("error");
        stopTracks(streamRef.current);
      };

      recorder.onstop = () => {
        const recordedType = recorder.mimeType || mimeType || "video/webm";
        const extension = recordedType.includes("mp4") ? "mp4" : "webm";
        const safeType = recordedType.includes("mp4") ? "video/mp4" : "video/webm";
        const blob = new Blob(chunksRef.current, { type: safeType });
        stopTracks(streamRef.current);
        streamRef.current = null;

        if (blob.size <= 0) {
          setError("La grabación terminó sin datos de video.");
          setState("error");
          return;
        }

        const capturedFile = new File(
          [blob],
          `clipforge-live-${Date.now()}.${extension}`,
          { type: safeType },
        );
        const validation = validateUploadDescriptor({
          filename: capturedFile.name,
          mimeType: capturedFile.type,
          size: capturedFile.size,
        });

        if (!validation.ok) {
          setError(validation.error || "La grabación no cumple las reglas de subida.");
          setState("error");
          return;
        }

        const url = URL.createObjectURL(capturedFile);
        setPreviewUrl(url);
        setFile(capturedFile);
        setState("ready");
      };

      for (const track of stream.getVideoTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (recorder.state === "recording") recorder.stop();
          },
          { once: true },
        );
      }

      recorder.start(1000);
      setState("recording");
    } catch (captureError) {
      stopTracks(streamRef.current);
      streamRef.current = null;
      setError(
        captureError instanceof Error
          ? captureError.message
          : "No se pudo iniciar la grabación.",
      );
      setState("error");
    }
  }

  function stopCapture() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    stopTracks(streamRef.current);
  }

  async function uploadCapture() {
    if (!file || state === "uploading") return;
    setState("uploading");
    setError(null);
    setAutopilotMessage(null);

    try {
      const readinessResponse = await fetch("/api/system/media-status", {
        cache: "no-store",
      });
      const readiness = (await readinessResponse.json()) as {
        ready?: boolean;
        message?: string;
      };
      if (!readiness.ready) {
        throw new Error(
          readiness.message || "El motor de video no está listo en este entorno.",
        );
      }

      const response = await fetch("/api/videos/upload", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Size": String(file.size),
        },
        body: file,
      });
      const payload = (await response.json()) as {
        video?: UploadedVideo;
        error?: string;
      };
      if (!response.ok || !payload.video) {
        throw new Error(payload.error || `La subida falló (HTTP ${response.status}).`);
      }

      setResult(payload.video);
      setState("done");
      window.dispatchEvent(new Event("clipforge:project-created"));

      const advance = await fetch(
        `/api/autopilot/projects/${payload.video.projectId}/advance`,
        { method: "POST" },
      );
      const advancePayload = (await advance.json()) as {
        result?: { state?: string };
        error?: string;
      };
      if (advance.ok) {
        setAutopilotMessage(
          `Autopilot inició el siguiente paso: ${advancePayload.result?.state || "procesamiento encolado"}.`,
        );
      } else {
        setAutopilotMessage(
          advancePayload.error ||
            "La grabación se guardó, pero Autopilot no pudo iniciar el siguiente paso.",
        );
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudo guardar la grabación.",
      );
      setState("error");
    }
  }

  function reset() {
    stopTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setResult(null);
    setError(null);
    setAutopilotMessage(null);
    setSource(null);
    setState("idle");
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300">
            Live · captura manual
          </p>
          <h2 className="mt-2 text-xl font-semibold">Marca el inicio y final de un momento</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            En computadora puedes capturar una pantalla, ventana o pestaña. En móvil,
            cuando el navegador no permite compartir pantalla, puedes grabar cámara y
            micrófono. Al terminar, ClipForge lo guarda como proyecto real y lo envía al
            mismo flujo de Whisper, Auto Edit y render.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
          {screenSupported
            ? "CAPTURA DE PANTALLA DISPONIBLE"
            : cameraSupported
              ? "MODO MÓVIL DISPONIBLE"
              : "NO DISPONIBLE EN ESTE NAVEGADOR"}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {state !== "recording" ? (
          <>
            {screenSupported ? (
              <button
                type="button"
                onClick={() => void startCapture("screen")}
                disabled={state === "requesting" || state === "uploading"}
                className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state === "requesting" && source === "screen"
                  ? "Esperando permiso…"
                  : "● CAPTURAR PANTALLA"}
              </button>
            ) : null}

            {cameraSupported ? (
              <button
                type="button"
                onClick={() => void startCapture("camera")}
                disabled={state === "requesting" || state === "uploading"}
                className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state === "requesting" && source === "camera"
                  ? "Esperando permiso…"
                  : "● GRABAR CÁMARA / MIC"}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={stopCapture}
            className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-200"
          >
            ■ TERMINAR
          </button>
        )}

        {file && state !== "uploading" && !result ? (
          <button
            type="button"
            onClick={() => void uploadCapture()}
            className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Procesar grabación con ClipForge
          </button>
        ) : null}

        {(file || result || error) && state !== "recording" ? (
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300"
          >
            Nueva grabación
          </button>
        ) : null}
      </div>

      {!screenSupported && cameraSupported ? (
        <p className="mt-3 text-xs leading-5 text-amber-200/70">
          Este navegador móvil no permite que una web grabe otra app o la pantalla completa.
          Para Twitch, YouTube Live o TikTok Live hace falta el módulo de entrada de streaming
          por URL/servidor; la grabación móvil disponible aquí usa cámara y micrófono reales.
        </p>
      ) : null}

      {state === "recording" ? (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">
          Grabando {source === "screen" ? "la pantalla autorizada" : "cámara y micrófono"}.
          Pulsa TERMINAR cuando acabe el momento.
        </div>
      ) : null}

      {previewUrl && file ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.7fr]">
          <video
            controls
            src={previewUrl}
            className="aspect-video w-full rounded-2xl bg-black object-contain"
          />
          <div className="rounded-2xl border border-white/10 p-4">
            <p className="text-sm font-medium">Grabación lista</p>
            <p className="mt-2 text-xs text-zinc-500">{formatBytes(file.size)}</p>
            <p className="mt-1 text-xs text-zinc-500">{file.type}</p>
            <p className="mt-4 text-xs leading-5 text-zinc-600">
              Límite de subida: {formatBytes(MAX_UPLOAD_BYTES)}. El video no se procesa
              hasta que pulses “Procesar grabación con ClipForge”.
            </p>
          </div>
        </div>
      ) : null}

      {state === "uploading" ? (
        <p className="mt-5 text-sm text-violet-300">Subiendo y validando la grabación real…</p>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
          <p className="text-sm font-semibold text-emerald-200">Grabación guardada como proyecto real</p>
          <p className="mt-1 break-all text-xs text-zinc-500">{result.projectId}</p>
          {autopilotMessage ? (
            <p className="mt-3 text-xs leading-5 text-zinc-400">{autopilotMessage}</p>
          ) : null}
          <ProjectPipeline projectId={result.projectId} />
        </div>
      ) : null}
    </section>
  );
}

function preferredRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
