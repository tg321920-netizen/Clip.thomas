"use client";

import { useEffect, useRef, useState } from "react";
import type { UploadedVideo } from "@/types/video";

type ImportJob = { id: string; status: string; stage: string; progress: number; retryable?: boolean; error?: string; result?: { video?: UploadedVideo } };
const field = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-900 px-3 py-3 text-base";
export function UrlImportPanel({ onReady, onUpload }: { onReady: (video: UploadedVideo | null) => void; onUpload: () => void }) {
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const observer = useRef<AbortController | null>(null);
  useEffect(() => () => observer.current?.abort(), []);

  async function importVideo(retry = false) {
    if (busy) return;
    const controller = new AbortController(); observer.current = controller;
    setBusy(true); setError(""); onReady(null);
    try {
      const endpoint = retry && job ? `/api/ingest/url/${job.id}` : "/api/ingest/url";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(retry ? { action: "RETRY" } : { url: url.trim(), mode: "IMPORT", rightsConfirmed: rights }),
      });
      const body = await response.json() as { job?: ImportJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error || `Error HTTP ${response.status}`);
      setJob(body.job); window.dispatchEvent(new Event("clipforge:project-created"));
      while (!controller.signal.aborted) {
        const status = await fetch(`/api/ingest/url/${body.job.id}`, { cache: "no-store", signal: controller.signal });
        const result = await status.json() as { job?: ImportJob; error?: string };
        if (!status.ok || !result.job) throw new Error(result.error || "No se pudo consultar la importación. El trabajo sigue disponible en Mis videos.");
        setJob(result.job);
        if (result.job.status === "COMPLETED") {
          if (!result.job.result?.video) throw new Error("El servidor no devolvió un video válido.");
          onReady(result.job.result.video); window.dispatchEvent(new Event("clipforge:project-created")); return;
        }
        if (result.job.status === "FAILED") throw new Error(result.job.error || "La fuente no pudo importarse.");
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new DOMException("Observación detenida", "AbortError")); };
          const timer = setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, 2000);
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "La importación falló.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (observer.current === controller) observer.current = null;
    }
  }
  return <div className="grid gap-4">
    <p className="text-sm leading-6 text-zinc-300">Importa un video propio o autorizado desde una fuente compatible. Si la plataforma exige acceso o bloquea la descarga, mostraremos la causa y podrás subir el archivo.</p>
    <label>Enlace del video<input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} className={field} placeholder="https://…" value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setJob(null); setError(""); onReady(null); }}/></label>
    <label className="flex min-h-12 items-center gap-3"><input className="h-5 w-5" type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} disabled={busy}/>Tengo autorización para importar este material.</label>
    <button type="button" className="min-h-12 rounded-xl bg-violet-500 px-5 py-3 font-semibold disabled:opacity-40" disabled={busy || !rights || !url.trim()} onClick={() => void importVideo()}>{busy ? "Importando…" : "Importar video"}</button>
    {job && <div role="status" className="rounded-xl border border-white/15 p-4"><p>{job.status === "FAILED" ? "Error · Importación detenida" : job.status === "COMPLETED" ? "Video importado" : job.stage === "RETRY_WAIT" ? "Esperando otro intento" : `${job.status} · ${job.stage}`}</p>{job.status !== "FAILED" && <progress aria-label="Progreso del trabajo en el servidor" className="mt-2 w-full" max={100} value={job.progress}/>}<p className="mt-2 text-sm text-zinc-400">{job.status === "FAILED" ? "El trabajo terminó sin importar el video. Cambia de fuente o sube un archivo autorizado." : job.status === "COMPLETED" ? "El video está listo para continuar." : "El trabajo continúa en el servidor si cierras esta pantalla. Su conservación depende del almacenamiento configurado."}</p></div>}
    {error && <div role="alert" className="text-sm text-red-300"><p>{error}</p>{job?.status === "FAILED" && job.retryable !== false && <button type="button" className="mt-3 min-h-12 rounded-xl border border-white/20 px-4 py-3" disabled={busy} onClick={() => void importVideo(true)}>Reintentar importación</button>}</div>}
    <button type="button" className="min-h-12 rounded-xl border border-white/20 px-4 py-3" onClick={onUpload}>Subir un archivo autorizado</button>
  </div>;
}
