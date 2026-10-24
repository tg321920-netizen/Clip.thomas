"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
type SavedClip = { id: string; title: string; duration: number; reason: string; keep: boolean; expiresAt: string | null; sourceUrl: string; downloadUrl: string };
type Library = { configured: boolean; message: string; clips: SavedClip[]; usedBytes?: number; maxBytes?: number; warning?: string };
export function CloudClipLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    if (mutating.current) return;
    const current = ++version.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    try {
      const response = await fetch('/api/media/library', { cache: 'no-store', signal: active.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo consultar la biblioteca.');
      if (current === version.current && !active.signal.aborted) { setLibrary(body); setError(''); }
    } catch (failure) { if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la biblioteca.'); }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    window.addEventListener('clipforge:project-created', refresh);
    return () => { clearTimeout(initial); clearInterval(timer); controller.current?.abort(); window.removeEventListener('clipforge:project-created', refresh); };
  }, [refresh]);
  async function preserve(clip: SavedClip) {
    if (mutating.current) return;
    mutating.current = true; ++version.current; controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(clip.id); setError('');
    try {
      const response = await fetch(`/api/media/library/${clip.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: active.signal, body: JSON.stringify({ keep: !clip.keep }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se confirmó el cambio.');
      if (!active.signal.aborted) setLibrary(previous => previous ? { ...previous, clips: previous.clips.map(item => item.id === clip.id ? body.clip : item) } : previous);
    } catch (failure) { if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se confirmó el cambio.'); }
    finally { mutating.current = false; setBusy(null); }
  }
  return <section aria-label="Clips guardados en nube" className="mt-5 rounded-2xl border border-emerald-500/30 p-4">
    <h3 className="text-lg font-semibold">Clips guardados</h3>
    <p className="mt-2 text-sm text-zinc-300">{library?.message || 'Consultando el guardado…'}</p>
    {library?.configured && <p className="mt-2 text-sm text-zinc-400">Aquí se conservan los MP4 finales. Guarda una copia del original para reeditarlo.</p>}
    {library?.configured && <p className="mt-2 text-sm text-zinc-400">{((library.usedBytes || 0) / 1e9).toFixed(2)} GB de {((library.maxBytes || 0) / 1e9).toFixed(0)} GB del límite de la biblioteca.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {library?.warning && <p role="status" className="mt-3 text-sm text-amber-200">{library.warning}</p>}
    <button type="button" className="mt-3 min-h-12 rounded-xl border border-white/20 px-4 py-3" onClick={() => void refresh()}>Actualizar biblioteca</button>
    {library?.configured && !library.clips.length && <p className="mt-3 text-sm text-zinc-400">Los clips nuevos aparecerán aquí cuando termine su guardado en nube.</p>}
    <div className="mt-4 grid gap-4 md:grid-cols-2">{library?.clips.map(clip => <article key={clip.id} className="min-w-0 rounded-xl border border-white/15 p-3">
      <h4 className="break-words font-medium">{clip.title}</h4>
      <video controls playsInline preload="none" src={clip.sourceUrl} onError={() => setError('No se pudo cargar el clip guardado. Reintenta su descarga o actualiza la biblioteca.')} className="mt-3 max-h-80 w-full rounded-xl bg-black" />
      <p className="mt-2 text-sm">{Math.round(clip.duration)} segundos · {clip.keep ? 'Conservado: no se elimina automáticamente' : `Se elimina después del ${new Date(clip.expiresAt || '').toLocaleDateString('es')}`}</p>
      {clip.reason && <p className="mt-2 text-sm text-zinc-400">{clip.reason}</p>}
      <div className="mt-3 flex flex-wrap gap-3"><a href={clip.downloadUrl} download className="inline-block min-h-12 rounded-xl bg-emerald-600 px-4 py-3">Descargar MP4</a>
        <button type="button" aria-pressed={clip.keep} disabled={busy !== null} onClick={() => void preserve(clip)} className="min-h-12 rounded-xl border border-white/20 px-4 py-3 disabled:opacity-50">{busy === clip.id ? 'Guardando…' : clip.keep ? 'Quitar Conservar' : 'Conservar'}</button></div>
    </article>)}</div>
  </section>;
}
