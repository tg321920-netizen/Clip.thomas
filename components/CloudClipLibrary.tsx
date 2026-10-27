"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
type SavedClip = { mediaKind?:'VIDEO'|'AUDIO'; origin?:{kind:string;platform?:string;sourceKind?:string;channel?:string}; review?: {status:string}; context?: {sourceReference?:{sourceUrl?:string;vodStartSeconds?:number|null;vodEndSeconds?:number|null;startUtc?:string|null;endUtc?:string|null};chatEvidence?:{peakMessages:number;peakUniqueSenders?:number|null;isPeak?:boolean;isCollectiveReaction?:boolean;repetitionEvidence?:{dominantTextSenders?:number|null}}|null;startTime:number;endTime:number;sourceDuration:number;analysisKind:string;before:string;transcript:string;after:string;transcriptWarning:string}; id: string; title: string; duration: number; reason: string; keep: boolean; expiresAt: string | null; sourceUrl: string; downloadUrl: string };
type Library = { configured: boolean; message: string; clips: SavedClip[]; usedBytes?: number; maxBytes?: number; warning?: string };
export function CloudClipLibrary({initialFilter='WESTCOL'}:{initialFilter?:'WESTCOL'|'ALL'}={}) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [sourceFilter,setSourceFilter]=useState<'WESTCOL'|'ALL'>(initialFilter);
  const [access, setAccess] = useState<{id:string;url:string;expiresAt:string}|null>(null);
  const [recut, setRecut] = useState<{id:string;start:string;end:string}|null>(null);
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
  async function review(clip:SavedClip,body:Record<string,unknown>){
    setBusy(clip.id);setError('');mutating.current=true;++version.current;controller.current?.abort();
    try{const response=await fetch(`/api/media/library/${clip.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw new Error(result.error);setLibrary(previous=>previous?{...previous,clips:previous.clips.map(c=>c.id===clip.id?result.clip:c)}:previous);setRecut(null);}catch(failure){setError(failure instanceof Error?failure.message:'No se confirmó la revisión.');}finally{mutating.current=false;setBusy(null);}
  }
  async function renew(clip:SavedClip){setBusy(clip.id);try{const response=await fetch(`/api/media/library/${clip.id}/access`,{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error);setAccess({id:clip.id,...result});}catch{setError('No se pudo renovar el acceso privado.');}finally{setBusy(null);}}
  const visibleClips=(library?.clips||[]).filter(clip=>clip.origin?.kind!=='TECHNICAL_TEST'&&(sourceFilter==='ALL'||clip.origin?.kind==='STREAM'&&clip.origin.platform==='KICK'&&clip.origin.channel==='westcol'));
  return <section aria-label="Clips guardados en nube" className="mt-5 rounded-2xl border border-emerald-500/30 p-4">
    <h3 className="text-lg font-semibold">{sourceFilter==='WESTCOL'?'Clips de Westcol':'Videos guardados'}</h3><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-12 rounded-xl border px-4" aria-pressed={sourceFilter==='WESTCOL'} onClick={()=>setSourceFilter('WESTCOL')}>Clips de Westcol</button><button className="min-h-12 rounded-xl border px-4" aria-pressed={sourceFilter==='ALL'} onClick={()=>setSourceFilter('ALL')}>Todos mis videos</button></div>
    <p className="mt-2 text-sm text-zinc-300">{library?.message || 'Consultando el guardado…'}</p>
    {library?.configured && <p className="mt-2 text-sm text-zinc-400">Los MP4 guardados pueden revisarse y descargarse. Los originales tienen su propio estado de respaldo en el panel de captura.</p>}
    {library?.configured && <p className="mt-2 text-sm text-zinc-400">{((library.usedBytes || 0) / 1e9).toFixed(2)} GB de {((library.maxBytes || 0) / 1e9).toFixed(0)} GB del límite de la biblioteca.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {library?.warning && <p role="status" className="mt-3 text-sm text-amber-200">{library.warning}</p>}
    <button type="button" className="mt-3 min-h-12 rounded-xl border border-white/20 px-4 py-3" onClick={() => void refresh()}>Actualizar biblioteca</button>
    {library?.configured && !visibleClips.length && <p className="mt-3 text-sm text-zinc-400">Los clips nuevos aparecerán aquí cuando termine su guardado en nube.</p>}
    <div className="mt-4 grid gap-4 md:grid-cols-2">{visibleClips.map(clip => <article key={clip.id} className="min-w-0 rounded-xl border border-white/15 p-3">
      <h4 className="break-words font-medium">{clip.title}</h4><p className="mt-1 text-sm text-zinc-400">{clip.origin?.kind==='STREAM'?`${clip.origin.platform}${clip.origin.channel?' · '+clip.origin.channel:''} · ${clip.origin.sourceKind==='LIVE'?'Capturado del directo':clip.origin.sourceKind==='VOD'?'Grabación de un directo':'Streaming'}`:'Video guardado'}</p>
      {clip.mediaKind==='AUDIO'?<audio controls preload="none" src={clip.sourceUrl} className="mt-3 w-full"/>:<video controls playsInline preload="none" src={clip.sourceUrl} onError={() => setError('No se pudo cargar el clip guardado. Reintenta su descarga o actualiza la biblioteca.')} className="mt-3 max-h-80 w-full rounded-xl bg-black" />}
      <p className="mt-2 text-sm">{Math.round(clip.duration)} segundos · {clip.keep ? 'Conservado: no se elimina automáticamente' : `Se elimina después del ${new Date(clip.expiresAt || '').toLocaleDateString('es')}`}</p>
      <p className="mt-2 text-sm text-amber-200">Revisión: {clip.review?.status || 'PENDING'} · {clip.context?.analysisKind || 'Origen de selección sin verificar'}</p>
      {clip.context && <details className="mt-2"><summary className="min-h-12 cursor-pointer">Ver contexto y nuevo recorte</summary><p className="text-sm text-amber-200">{clip.context.transcriptWarning}</p><p className="mt-2 text-sm">Antes: {clip.context.before || 'Sin transcripción disponible'}</p><p className="mt-2 text-sm">Momento: {clip.context.transcript || 'Sin transcripción disponible'}</p><p className="mt-2 text-sm">Después: {clip.context.after || 'Sin transcripción disponible'}</p><p className="mt-2 text-sm">Intervalo en la fuente guardada: {clip.context.startTime?.toFixed(1)}–{clip.context.endTime?.toFixed(1)} s</p>{clip.context.sourceReference?.vodStartSeconds!=null&&<p className="mt-2 text-sm">Posición en el VOD: {clip.context.sourceReference.vodStartSeconds.toFixed(1)}–{clip.context.sourceReference.vodEndSeconds?.toFixed(1)} s</p>}{clip.context.chatEvidence?<p className="mt-2 text-sm">Chat observado: {clip.context.chatEvidence.peakMessages} mensajes; {clip.context.chatEvidence.peakUniqueSenders??'sin recuento de'} cuentas distintas. {clip.context.chatEvidence.isCollectiveReaction?'Reacción colectiva detectada.':clip.context.chatEvidence.isPeak?'Pico de actividad detectado.':'Sin pico colectivo confirmado.'}</p>:<p className="mt-2 text-sm text-zinc-400">Sin chat observado para este intervalo; la selección necesita revisión audiovisual.</p>}{clip.context.sourceReference?.sourceUrl&&<a className="mt-2 inline-block min-h-12 py-3 underline" href={clip.context.sourceReference.sourceUrl} target="_blank" rel="noreferrer">Fuente original en Kick</a>}<button disabled={busy!==null} className="mt-2 min-h-12 rounded-xl border px-4" onClick={()=>setRecut({id:clip.id,start:String(clip.context?.startTime||0),end:String(clip.context?.endTime||30)})}>Solicitar nuevo recorte</button></details>}
      {recut?.id===clip.id&&<form className="mt-3 grid gap-3" onSubmit={event=>{event.preventDefault();void review(clip,{action:'recut',startTime:Number(recut.start),endTime:Number(recut.end)});}}><label>Inicio del nuevo recorte (segundos)<input type="number" min="0" step="0.1" value={recut.start} onChange={e=>setRecut({...recut,start:e.target.value})} className="mt-1 min-h-12 w-full rounded-xl bg-zinc-900 p-3" /></label><label>Final del nuevo recorte (segundos)<input type="number" min="15" step="0.1" value={recut.end} onChange={e=>setRecut({...recut,end:e.target.value})} className="mt-1 min-h-12 w-full rounded-xl bg-zinc-900 p-3" /></label><p className="text-sm">Se conservará esta versión. La nueva necesita el original local y un worker de render activo.</p><button disabled={busy!==null} className="min-h-12 rounded-xl border px-4">Encolar recorte</button><button type="button" className="min-h-12 rounded-xl border px-4" onClick={()=>setRecut(null)}>Cancelar recorte</button></form>}
      {clip.reason && <p className="mt-2 text-sm text-zinc-400">{clip.reason}</p>}
      <div className="mt-3 flex flex-wrap gap-3"><a href={clip.downloadUrl} download className="inline-block min-h-12 rounded-xl bg-emerald-600 px-4 py-3">{clip.mediaKind==='AUDIO'?'Descargar M4A':'Descargar MP4'}</a>
        <button disabled={busy!==null} onClick={()=>void review(clip,{review:clip.review?.status==='REJECTED'?'PENDING':'REJECTED'})} className="min-h-12 rounded-xl border px-4">{clip.review?.status==='REJECTED'?'Volver a revisión':'Rechazar'}</button><button disabled={busy!==null} onClick={()=>void renew(clip)} className="min-h-12 rounded-xl border px-4">Renovar acceso privado</button><button type="button" aria-pressed={clip.keep} disabled={busy !== null} onClick={() => void preserve(clip)} className="min-h-12 rounded-xl border border-white/20 px-4 py-3 disabled:opacity-50">{busy === clip.id ? 'Guardando…' : clip.keep ? 'Quitar Conservar' : 'Conservar'}</button></div>
      {access?.id===clip.id&&<p className="mt-3 text-sm"><a href={access.url} rel="noreferrer" className="inline-block min-h-12 break-words py-3 underline">Descargar con enlace temporal</a><br/>Caduca: {new Date(access.expiresAt).toLocaleTimeString('es')}. Quien tenga este enlace puede descargarlo hasta entonces.</p>}
    </article>)}</div>
  </section>;
}
