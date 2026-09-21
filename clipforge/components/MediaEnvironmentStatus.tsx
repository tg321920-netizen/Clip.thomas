"use client";

import { useEffect, useState } from "react";

type MediaStatusPayload = {
  ready: boolean;
  message: string;
  tools: {
    ffmpeg: { available: boolean; version?: string };
    ffprobe: { available: boolean; version?: string };
  };
};

export function MediaEnvironmentStatus() {
  const [status, setStatus] = useState<MediaStatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/system/media-status", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as MediaStatusPayload;
        if (active) setStatus(payload);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!status && !failed) {
    return (
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-500">
        Verificando FFmpeg y FFprobe…
      </div>
    );
  }

  if (failed || !status) {
    return (
      <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] p-4 text-sm text-amber-200">
        No se pudo comprobar el entorno de procesamiento.
      </div>
    );
  }

  return (
    <div
      className={`mt-5 rounded-2xl border p-4 ${
        status.ready
          ? "border-emerald-400/20 bg-emerald-400/[0.07]"
          : "border-amber-400/20 bg-amber-400/[0.08]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={`text-sm font-medium ${
            status.ready ? "text-emerald-200" : "text-amber-200"
          }`}
        >
          {status.ready ? "Motor de video listo" : "Motor de video incompleto"}
        </p>
        <span
          className={`text-[11px] font-semibold ${
            status.ready ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          {status.ready ? "READY" : "NO READY"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Tool name="FFmpeg" available={status.tools.ffmpeg.available} />
        <Tool name="FFprobe" available={status.tools.ffprobe.available} />
      </div>

      {!status.ready && (
        <p className="mt-3 text-xs leading-5 text-amber-200/70">
          La interfaz puede cargar, pero el análisis real de video necesita un
          entorno o worker con FFmpeg y FFprobe instalados.
        </p>
      )}
    </div>
  );
}

function Tool({ name, available }: { name: string; available: boolean }) {
  return (
    <div className="rounded-xl bg-black/20 px-3 py-2 text-zinc-400">
      <span>{name}</span>
      <span className="float-right font-medium text-zinc-200">
        {available ? "OK" : "Falta"}
      </span>
    </div>
  );
}
