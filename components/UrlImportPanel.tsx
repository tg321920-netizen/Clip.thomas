"use client";

import { useEffect, useRef, useState } from "react";
import type { UploadedVideo } from "@/types/video";

type ImportJob = { id: string; status: string; stage: string; progress: number; retryable?: boolean; error?: string; result?: { video?: UploadedVideo; clipsJobId?: string; requestedClipCount?: number } };
const field = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-900 px-3 py-3 text-base";
export function UrlImportPanel({ onReady, onUpload }: { onReady: (video: UploadedVideo | null) => void; onUpload: () => void }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"IMPORT" | "STREAM">("IMPORT");
  const [captureSeconds, setCaptureSeconds] = useState(180);
  const [autoClip, setAutoClip] = useState(false);
  const [liveClipCount, setLiveClipCount] = useState(5);
  const [liveClipMode, setLiveClipMode] = useState<"CAPTURE" | "SEGMENTS">("CAPTURE");
  const [liveClipDuration, setLiveClipDuration] = useState(30);
  const [liveStatus, setLiveStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [segmentSeconds, setSegmentSeconds] = useState(60);
  const [rights, setRights] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const observer = useRef<AbortController | null>(null);
  useEffect(() => () => observer.current?.abort(), []);

  function changeMode(nextMode: "IMPORT" | "STREAM") {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    setUrl("");
    setJob(null);
    setError("");
    onReady(null);
  }

  async function importVideo(retry = false) {
    if (busy) return;
    const controller = new AbortController(); observer.current = controller;
    setBusy(true); setError(""); onReady(null);
    try {
      const endpoint = retry && job ? `/api/ingest/url/${job.id}` : "/api/ingest/url";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(retry ? { action: "RETRY" } : {
          url: url.trim(),
          mode,
          ...(mode === "STREAM" ? { captureSeconds, segmentSeconds, autoClip, clipDuration: liveClipDuration, clipCount: liveClipCount, clipMode: liveClipMode } : {}),
          rightsConfirmed: rights,
        }),
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
        if (result.job.status === "CANCELLED") return;
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
  async function checkLive() {
    setChecking(true); setLiveStatus("");
    try {
      const response = await fetch("/api/streams/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json() as { source?: { state: string; message: string }; error?: string };
      if (!response.ok || !body.source) throw new Error(body.error || "No se pudo consultar.");
      const labels: Record<string, string> = { LIVE: "En directo", OFFLINE: "Desconectado", ENDED: "Directo terminado", SCHEDULED: "Programado", VOD: "Grabación", UNCONFIGURED: "Consulta sin configurar", ACCESS_DENIED: "Acceso rechazado", NOT_FOUND: "No encontrado" };
      setLiveStatus(`${labels[body.source.state] || body.source.state}. ${body.source.message}`);
    } catch (failure) { setLiveStatus(failure instanceof Error ? failure.message : "No se pudo consultar."); }
    finally { setChecking(false); }
  }
  async function cancelImport() {
    if (!job) return;
    try {
      const response = await fetch(`/api/ingest/url/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CANCEL" }) });
      const body = await response.json() as { job?: ImportJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error || "No se pudo cancelar.");
      setJob(body.job);
      observer.current?.abort();
      setBusy(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cancelar."); }
  }
  return <div className="grid gap-4">
    <p className="text-sm leading-6 text-zinc-300">Importa un video propio o autorizado desde una fuente compatible. Si la plataforma exige acceso o bloquea la descarga, mostraremos la causa y podrás subir el archivo.</p>
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/15 p-1">
      <button type="button" className={`min-h-12 rounded-lg px-3 ${mode === "IMPORT" ? "bg-violet-500 font-semibold" : "text-zinc-300"}`} disabled={busy} onClick={() => changeMode("IMPORT")}>Video grabado</button>
      <button type="button" className={`min-h-12 rounded-lg px-3 ${mode === "STREAM" ? "bg-violet-500 font-semibold" : "text-zinc-300"}`} disabled={busy} onClick={() => changeMode("STREAM")}>Directo activo</button>
    </div>
    <label>{mode === "STREAM" ? "Enlace del canal o del directo" : "Enlace del video"}<input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} className={field} placeholder={mode === "STREAM" ? "https://kick.com/canal" : "https://…/videos/…"} value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setJob(null); setError(""); onReady(null); }}/></label>
    {mode === "STREAM" && <><button type="button" disabled={checking || busy || !url.trim()} className="min-h-12 rounded-xl border border-white/20 px-4 py-3 disabled:opacity-40" onClick={() => void checkLive()}>{checking ? "Consultando API oficial…" : "Consultar si está en directo"}</button><p role="status" className="text-sm text-zinc-300">{liveStatus || "Kick, Twitch y YouTube tienen consultas independientes. El acceso al medio depende de los permisos y de cada plataforma."}</p></>}
    {mode === "STREAM" && <label>Tiempo a capturar (segundos)<input type="number" min={60} max={900} step={30} className={field} value={captureSeconds} disabled={busy} onChange={event => setCaptureSeconds(Math.max(60, Math.min(900, Math.round(Number(event.target.value) || 180))))}/><span className="mt-2 block text-sm text-zinc-400">El canal debe estar transmitiendo ahora. ClipForge captura este tramo y después permite buscar los mejores momentos.</span></label>}
    {mode === "STREAM" && <label>Duración de segmento<select className={field} value={segmentSeconds} disabled={busy} onChange={event => setSegmentSeconds(Number(event.target.value))}>{[30, 60, 120, 300].map(seconds => <option key={seconds} value={seconds}>{seconds} segundos</option>)}</select></label>}
    {mode === "STREAM" && <><label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={autoClip} disabled={busy} onChange={event => setAutoClip(event.target.checked)}/>Generar clips automáticamente</label>{autoClip && <>
      <label>Selección de clips<select aria-label="Selección de clips del directo" className={field} value={liveClipMode} disabled={busy} onChange={event => setLiveClipMode(event.target.value as "CAPTURE" | "SEGMENTS")}><option value="CAPTURE">Elegir una cantidad total al terminar la captura</option><option value="SEGMENTS">Un clip por segmento mientras se captura</option></select></label>
      {liveClipMode === "CAPTURE" && <label>Cantidad total de clips<input aria-label="Cantidad total de clips del directo" type="number" min={1} max={10} step={1} className={field} value={liveClipCount} disabled={busy} onChange={event => setLiveClipCount(Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 5))))}/><span className="mt-2 block text-sm text-zinc-400">Se buscarán {liveClipCount} momentos diferentes de toda la captura, independientemente de cuántos segmentos se graben.</span></label>}
      <label>Duración objetivo<select className={field} value={liveClipDuration} disabled={busy} onChange={event => setLiveClipDuration(Number(event.target.value))}>{[15, 30, 45, 60, 90].map(seconds => <option key={seconds} value={seconds}>{seconds} segundos</option>)}</select><span className="mt-2 block text-sm text-zinc-400">Los resultados aparecen en Mis videos. Si no hay suficientes momentos completos, el trabajo indicará que necesita ajuste. No se publica contenido.</span></label></>}</>}
    <label className="flex min-h-12 items-center gap-3"><input className="h-5 w-5" type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} disabled={busy}/>Tengo autorización para importar este material.</label>
    <button type="button" className="min-h-12 rounded-xl bg-violet-500 px-5 py-3 font-semibold disabled:opacity-40" disabled={busy || !rights || !url.trim()} onClick={() => void importVideo()}>{busy ? mode === "STREAM" ? "Capturando directo…" : "Importando…" : mode === "STREAM" ? `Capturar ${captureSeconds} segundos` : "Importar video"}</button>
    {job && <div role="status" className="rounded-xl border border-white/15 p-4"><p>{job.status === "CANCELLED" ? "Captura cancelada" : job.status === "FAILED" ? "Error · Importación detenida" : job.status === "COMPLETED" ? "Video importado" : job.stage === "RETRY_WAIT" ? "Esperando otro intento" : `${job.status} · ${job.stage}`}</p>{job.status !== "FAILED" && <progress aria-label="Progreso del trabajo en el servidor" className="mt-2 w-full" max={100} value={job.progress}/>}<p className="mt-2 text-sm text-zinc-400">{job.status === "FAILED" ? "El trabajo terminó sin importar el video. Cambia de fuente o sube un archivo autorizado." : job.status === "COMPLETED" ? (job.result?.clipsJobId ? `Captura guardada. Se inició el trabajo para ${job.result.requestedClipCount} clips; consulta Mis videos.` : "El video está listo para continuar.") : "El trabajo continúa en el servidor si cierras esta pantalla. Su conservación depende del almacenamiento configurado."}</p></div>}
    {busy && job && <button type="button" className="min-h-12 rounded-xl border border-red-400/50 px-4 py-3" onClick={() => void cancelImport()}>Cancelar trabajo en el servidor</button>}
    {job?.status === "CANCELLED" && <button type="button" className="min-h-12 rounded-xl border border-white/20 px-4 py-3" onClick={() => void importVideo(true)}>Reanudar desde los segmentos guardados</button>}
    {error && <div role="alert" className="text-sm text-red-300"><p>{error}</p>{job?.status === "FAILED" && job.retryable !== false && <button type="button" className="mt-3 min-h-12 rounded-xl border border-white/20 px-4 py-3" disabled={busy} onClick={() => void importVideo(true)}>Reintentar importación</button>}</div>}
    <button type="button" className="min-h-12 rounded-xl border border-white/20 px-4 py-3" onClick={onUpload}>Subir un archivo autorizado</button>
  </div>;
}
