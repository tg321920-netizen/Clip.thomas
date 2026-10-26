'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {UploadedVideo} from '@/types/video';
import type {ClipRecord, SubtitleMode} from '@/types/clip';
import {ClipSubtitleEditor} from '@/components/ClipSubtitleEditor';

type SavedClip=ClipRecord & {job?:{status:string;progress?:number;error?:string}|null};
const field='mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-900 px-3 py-3 text-base';
export function ManualClipEditor({video,videoRef}:{video:UploadedVideo;videoRef:RefObject<HTMLVideoElement|null>}){
  const[start,setStart]=useState('0'),[end,setEnd]=useState(String(Math.min(30,video.durationSeconds))),[framing,setFraming]=useState('FIT');
  const[rights,setRights]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[clips,setClips]=useState<SavedClip[]>([]);
  const[aspectRatio,setAspectRatio]=useState('9:16'),[resolution,setResolution]=useState('default'),[quality,setQuality]=useState('EFFICIENT');
  const[subtitleMode,setSubtitleMode]=useState<SubtitleMode>('NONE');
  const[refreshError,setRefreshError]=useState('');
  const previewing=useRef(false);
  const refresh=useCallback(async()=>{try{const response=await fetch(`/api/projects/${video.projectId}/clips`,{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.error);setClips(body.clips||[]);setRefreshError('');}catch{setRefreshError('No se pudo actualizar el recorte. El trabajo del servidor no se cancela al cerrar esta pantalla.');}},[video.projectId]);
  useEffect(()=>{const startTimer=setTimeout(()=>void refresh(),0),timer=setInterval(()=>{if(!document.hidden)void refresh();},2500);return()=>{clearTimeout(startTimer);clearInterval(timer);};},[refresh]);
  useEffect(()=>{const player=videoRef.current;const stop=()=>{if(previewing.current&&player&&player.currentTime>=Number(end)){player.pause();previewing.current=false;}};player?.addEventListener('timeupdate',stop);return()=>player?.removeEventListener('timeupdate',stop);},[videoRef,end]);
  useEffect(()=>{const choose=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.projectId!==video.projectId)return;setStart(String(detail.startTime));setEnd(String(detail.endTime));document.getElementById(`manual-clip-${video.projectId}`)?.scrollIntoView({behavior:'smooth'});};window.addEventListener('clipforge:trim-interval',choose);return()=>window.removeEventListener('clipforge:trim-interval',choose);},[video.projectId]);
  async function generate(){setBusy(true);setError('');try{const response=await fetch(`/api/projects/${video.projectId}/clips`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startTime:Number(start),endTime:Number(end),framingMode:framing,quality,aspectRatio,subtitleMode,...(resolution==='default'?{}:{resolution}),rightsConfirmed:rights})}),body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo encolar el recorte.');await refresh();window.dispatchEvent(new Event('clipforge:project-created'));}catch(failure){setError(failure instanceof Error?failure.message:'No se pudo crear el recorte.');}finally{setBusy(false);}}
  async function retry(clipId:string){
    setBusy(true);setError('');
    try{const response=await fetch(`/api/projects/${video.projectId}/clips`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retryClipId:clipId})}),body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo reanudar el trabajo.');await refresh();}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo reanudar el trabajo.');}finally{setBusy(false);}
  }
  const valid=Number.isFinite(Number(start))&&Number.isFinite(Number(end))&&start.trim()!==''&&end.trim()!==''&&Number(start)>=0&&Number(end)<=video.durationSeconds&&Number(end)-Number(start)>=0.5&&Number(end)-Number(start)<=180;
  return <section id={`manual-clip-${video.projectId}`} aria-label="Recorte manual" className="mt-5 rounded-2xl border border-violet-400/40 p-4">
    <h3 className="text-lg font-semibold">Elegí tu fragmento</h3><p className="mt-2 text-sm text-zinc-300">Reproduce el original y marca el inicio y el final. Este recorte conserva el audio y funciona sin IA ni transcripción.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><label>Inicio del fragmento (segundos)<input aria-label="Inicio del fragmento en segundos" className={field} type="number" inputMode="decimal" min={0} max={video.durationSeconds} step="0.1" value={start} onChange={e=>setStart(e.target.value)}/><button type="button" className="mt-2 min-h-12 rounded-xl border px-3" onClick={()=>setStart((videoRef.current?.currentTime||0).toFixed(1))}>Marcar inicio aquí</button></label>
    <label>Final del fragmento (segundos)<input aria-label="Final del fragmento en segundos" className={field} type="number" inputMode="decimal" min={0.5} max={video.durationSeconds} step="0.1" value={end} onChange={e=>setEnd(e.target.value)}/><button type="button" className="mt-2 min-h-12 rounded-xl border px-3" onClick={()=>setEnd((videoRef.current?.currentTime||0).toFixed(1))}>Marcar final aquí</button></label></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label>Formato<select aria-label="Formato del recorte" className={field} value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select></label>
      <label>Resolución<select aria-label="Resolución del recorte" className={field} value={resolution} onChange={e=>setResolution(e.target.value)}><option value="default">Predeterminada del servidor</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
    </div>
    <label className="mt-4 block">Velocidad y calidad<select aria-label="Calidad del recorte" className={field} value={quality} onChange={e=>setQuality(e.target.value)}><option value="EFFICIENT">Ágil · calidad equilibrada</option><option value="BALANCED">Compresión equilibrada · más lento</option><option value="HIGH">Calidad alta · más lento</option><option value="FAST">Borrador rápido · menor calidad</option></select></label>
    <label className="mt-4 block">Encuadre del recorte<select aria-label="Encuadre del recorte" className={field} value={framing} onChange={e=>setFraming(e.target.value)}><option value="FIT">Conservar toda la imagen</option><option value="CONVERSATION">Fondo desenfocado</option><option value="FILL">Recorte central</option></select></label>
    <label className="mt-4 block">Subtítulos del recorte<select aria-label="Subtítulos del recorte" className={field} value={subtitleMode} onChange={e=>setSubtitleMode(e.target.value as SubtitleMode)}><option value="NONE">Sin subtítulos</option><option value="ORIGINAL_ES">Español → español</option><option value="ORIGINAL_EN">Inglés → inglés</option><option value="TRANSLATE_ES">Inglés → español traducido</option></select></label>
    {subtitleMode!=='NONE'&&<p className="mt-2 text-sm text-amber-200">Requiere Whisper en el servidor. Traducir requiere además el modelo local inglés-español. El audio original se conserva; revisa el texto antes de publicar.</p>}
    <p className="mt-3 text-sm">{valid?`Duración: ${(Number(end)-Number(start)).toFixed(1)} segundos.`:'Elige entre 0,5 y 180 segundos dentro del original.'} Subtítulos desactivados para conservar un resultado sin texto incorrecto.</p>
    <button type="button" disabled={!valid} className="mt-3 min-h-12 rounded-xl border px-4 disabled:opacity-40" onClick={()=>{const player=videoRef.current;if(player){player.currentTime=Number(start);previewing.current=true;void player.play().catch(()=>setError('Pulsa reproducir en el video original.'));}}}>Previsualizar fragmento</button>
    <label className="mt-4 flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={rights} onChange={e=>setRights(e.target.checked)}/>Tengo autorización para recortar este video.</label>
    <button type="button" disabled={!valid||!rights||busy} className="mt-3 min-h-12 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-40" onClick={()=>void generate()}>{busy?'Guardando recorte…':'Generar MP4 del fragmento'}</button>
    <p className="mt-3 text-sm text-zinc-400">El render se ejecuta en el servidor. Puedes volver al proyecto para consultar el resultado mientras el servidor y sus archivos sigan disponibles.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {refreshError&&<p role="status" className="mt-3 text-sm text-amber-200">{refreshError}</p>}
    {clips.filter(c=>c.candidateId?.startsWith('manual-')).map(clip=><article key={clip.id} aria-label="Resultado del recorte manual" className="mt-4 rounded-xl border border-white/20 p-3"><p className="text-sm">{clip.startTime.toFixed(1)}–{clip.endTime.toFixed(1)} s · {clip.status==='READY'?'MP4 disponible':clip.status==='FAILED'?'Error de render':clip.job?.status==='PROCESSING'?'Preparando subtítulos o renderizando':'Esperando al worker'}</p>
      {clip.status!=='READY'&&clip.status!=='FAILED'&&<div role="progressbar" aria-label="Progreso del recorte" aria-valuenow={clip.job?.progress||0} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-2 overflow-hidden rounded bg-white/10"><div className="h-full bg-violet-500" style={{width:`${clip.job?.progress||0}%`}}/></div>}
      {(clip.error||clip.job?.error)&&<p role="alert" className="mt-2 text-sm text-red-300">{clip.error||clip.job?.error}</p>}
      {clip.status!=='READY'&&['DRAFT','FAILED','WAITING_RESOURCE'].some(state=>state===clip.status||state===clip.job?.status)&&<button type="button" disabled={busy} className="mt-3 min-h-12 rounded-xl border px-4 py-3 disabled:opacity-40" onClick={()=>void retry(clip.id)}>Reintentar render</button>}
      {clip.status==='READY'&&clip.render&&<><video aria-label="Reproducir recorte manual" controls playsInline preload="none" src={clip.render.sourceUrl} className="mt-3 max-h-96 w-full rounded-xl bg-black"/><p className="mt-2 text-sm text-amber-200">Selección manual · revisión pendiente.</p><a href={`${clip.render.sourceUrl}?download=1`} download className="mt-3 inline-block min-h-12 rounded-xl bg-emerald-600 px-4 py-3 font-semibold">Descargar recorte MP4</a><ClipSubtitleEditor key={`${clip.id}:${clip.updatedAt}`} projectId={video.projectId} clip={clip} onRenderNeeded={()=>retry(clip.id)}/></>}
    </article>)}
  </section>;
}
