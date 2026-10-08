"use client";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";
import { UrlImportPanel } from "@/components/UrlImportPanel";
import type { UploadedVideo } from "@/types/video";

type Tool = "URL_IMPORT" | "MEDIA_STORY" | "MEDIA_EDIT" | "MEDIA_CLIPS";
type Output = { clipId: string; title?: string; sourceUrl: string; downloadUrl: string; duration?: number; startTime?: number; endTime?: number; reason?: string; validation?: { duration: number } };
type Job = { id: string; projectId: string; type: Tool; createdAt: string; status: string; stage: string; progress: number; error?: string; result?: Output & { clips?: Output[] } };
type UploadJob = { id:string;type:string;name:string;status:string;stage:string;error?:string };
type StoryStatus = { automaticReady: boolean; scriptReady: boolean; imageReady: boolean; message: string; maxCostUsd: number | null };
const TOOLS: [Tool,string,string][] = [["URL_IMPORT","PEGAR URL","Importar un video autorizado"],["MEDIA_EDIT","SUBIR Y EDITAR VIDEO","Cortes, subtítulos y formato vertical"],["MEDIA_CLIPS","CREAR MEJORES CLIPS","Tres momentos distintos de tu video"],["MEDIA_STORY","CREAR HISTORIA CON IA","Guion, escenas, imágenes y voz"]];
const STATUS: Record<string,string> = { QUEUED:"En cola", PROCESSING:"Procesando", VALIDATING:"Comprobando archivo", READY:"Archivo disponible", WAITING_RESOURCE:"Necesita un ajuste o recurso", FAILED:"Error", CANCELLED:"Cancelado" };
const field = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-900 px-3 py-3 text-base text-white";
const button = "min-h-12 rounded-xl bg-violet-500 px-5 py-3 text-base font-semibold text-white disabled:opacity-40";
async function request(url: string, init?: RequestInit) { const response = await fetch(url,init); const body = await response.json(); if (!response.ok) throw new Error(body.error || body.message || "No se pudo completar la operación."); return body; }
async function uploadAsset(file: File) { if (file.size > 4*1024*1024) throw new Error(`${file.name} supera 4 MB.`); return (await request("/api/media/assets",{method:"POST",headers:{"Content-Type":file.type || "application/octet-stream","X-Rights-Confirmed":"true"},body:file})).relativePath as string; }

export function MediaTools() {
  const [tool,setTool] = useState<Tool>("MEDIA_CLIPS");
  const [topic,setTopic] = useState("");
  const [narration,setNarration] = useState(""); const [duration,setDuration] = useState(60); const [custom,setCustom] = useState(false);
  const [format,setFormat] = useState("9:16"); const [style,setStyle] = useState("cinematográfico");
  const [images,setImages] = useState<File[]>([]); const [music,setMusic] = useState<File|null>(null); const [rights,setRights] = useState(false);
  const [generationMode,setGenerationMode] = useState("OWN"); const [sceneCount,setSceneCount] = useState(6); const [storyStatus,setStoryStatus] = useState<StoryStatus|null>(null);
  const [subtitles,setSubtitles] = useState(true); const [original,setOriginal] = useState<UploadedVideo|null>(null); const [intensity,setIntensity] = useState("GENTLE");
  const [imported,setImported] = useState<UploadedVideo|null>(null);
  const [count,setCount] = useState(3); const [minDuration,setMinDuration] = useState(30); const [maxDuration,setMaxDuration] = useState(60);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [error,setError] = useState(""); const [jobs,setJobs] = useState<Job[]>([]); const [historyError,setHistoryError] = useState("");
  const onReady = useCallback((video: UploadedVideo | null) => setOriginal(video),[]);
  const onImportReady = useCallback((video: UploadedVideo | null) => { setImported(video); setOriginal(video); },[]);
  const [uploads,setUploads] = useState<UploadJob[]>([]);
  useEffect(() => {
    const open = (event: Event) => {
      const video = (event as CustomEvent<UploadedVideo>).detail;
      if (!video?.projectId) return;
      setOriginal(video); setTool(current=>current==="MEDIA_EDIT"?current:"MEDIA_CLIPS"); setError(""); setMessage("");
    };
    window.addEventListener("clipforge:project-open", open);
    return () => window.removeEventListener("clipforge:project-open", open);
  }, []);
  useEffect(() => {
    let active=true, fetching=false; let timer: ReturnType<typeof setTimeout>;
    const refresh=async()=>{ if(fetching)return; fetching=true; try {const body=await request("/api/media/jobs",{cache:"no-store"}); if(active){setJobs(body.jobs||[]);setUploads(body.uploads||[]);setStoryStatus(body.story||null);setHistoryError("");}} catch(failure){if(active)setHistoryError(failure instanceof Error?failure.message:"No se pudo cargar el historial.");} finally{fetching=false;if(active)timer=setTimeout(()=>void refresh(),document.hidden?15000:4000);} };
    const notify=()=>{clearTimeout(timer);void refresh();}; void refresh(); window.addEventListener("clipforge:project-created",notify);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener("clipforge:project-created",notify);};
  },[]);
  async function generate(){setBusy(true);setError("");setMessage("");try{
    let payload: Record<string,unknown>;
    if(tool==="MEDIA_STORY"){
      if((generationMode==="OWN"||music)&&!rights)throw new Error("Confirma que tienes derechos sobre las imágenes y la música.");
      if(generationMode==="OWN"&&images.length<sceneCount)throw new Error(`Elige ${sceneCount} imágenes distintas.`);
      if(generationMode==="AI"&&!storyStatus?.automaticReady)throw new Error(storyStatus?.message||"La generación automática todavía no está configurada.");
      const paths:string[]=[];
      if(generationMode==="OWN")for(const image of images.slice(0,sceneCount)){paths.push(await uploadAsset(image));setMessage(`Imágenes guardadas: ${paths.length}/${sceneCount}`);}
      payload={topic,narration,duration,format,style,sceneCount,generationMode,images:paths,subtitles,music:music?await uploadAsset(music):undefined};
    }else{if(!original)throw new Error("Primero sube y analiza el video original.");payload={projectId:original.projectId,intensity,subtitles,count,minDuration,maxDuration,format:"9:16"};}
    const body=await request("/api/media/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:tool,id:crypto.randomUUID(),payload})});
    setJobs(previous=>[body.job,...previous.filter(j=>j.id!==body.job.id)]);setMessage("Trabajo guardado. Puedes cerrar la página y consultar el resultado en Mis videos.");window.dispatchEvent(new Event("clipforge:project-created"));
  }catch(failure){setError(failure instanceof Error?failure.message:"No se pudo iniciar el trabajo.");}finally{setBusy(false);}}
  async function action(job:Job,value:string){try{const body=await request(`/api/media/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:value})});setJobs(previous=>previous.map(j=>j.id===job.id?body.job:j));}catch(failure){setHistoryError(failure instanceof Error?failure.message:"No se pudo actualizar el trabajo.");}}
  return <>
    <nav aria-label="Herramientas de video" className="grid grid-cols-2 gap-3 py-6 lg:grid-cols-4">{TOOLS.map(([id,title,description])=><button key={id} type="button" aria-label={title} aria-pressed={tool===id} disabled={busy} onClick={()=>{setTool(id);setError("");setMessage("");}} className={`min-h-28 rounded-2xl border p-4 text-left ${tool===id?"border-violet-400 bg-violet-500/20":"border-white/15 bg-white/5"}`}><span className="block text-sm font-bold">{title}</span><span className="mt-2 block text-sm text-zinc-300">{description}</span></button>)}</nav>
    <section aria-label={TOOLS.find(t=>t[0]===tool)?.[1]} className="rounded-3xl border border-white/15 bg-white/5 p-5 sm:p-7"><h2 className="mb-5 text-xl font-semibold">{TOOLS.find(t=>t[0]===tool)?.[1]}</h2><div className="grid gap-5">
      {tool==="URL_IMPORT"?<><UrlImportPanel onReady={onImportReady} onUpload={()=>setTool("MEDIA_EDIT")}/>{imported&&<div className="grid gap-3"><p className="text-emerald-300">Importado: {imported.originalName}</p><video controls playsInline preload="metadata" src={imported.sourceUrl} poster={imported.posterUrl} className="max-h-80 w-full rounded-xl"/><a className={button} href={`${imported.sourceUrl}?download=1`} download>Descargar original</a><button type="button" className={button} onClick={()=>{setOriginal(imported);setTool("MEDIA_CLIPS");}}>Crear clips de este video</button><button type="button" className={button} onClick={()=>{setOriginal(imported);setTool("MEDIA_EDIT");}}>Editar este video</button></div>}</>:tool==="MEDIA_STORY"?<>
        <label>Tema o idea<textarea className={field} rows={3} maxLength={2000} value={topic} onChange={e=>setTopic(e.target.value)}/></label>
        <p className="text-sm leading-6 text-zinc-300">{storyStatus?.message||"Comprobando proveedores de guion e imágenes…"} Las imágenes propias permiten montar una historia; esa opción no genera imágenes mediante IA.</p>
        <label>Modo visual<select className={field} value={generationMode} onChange={e=>setGenerationMode(e.target.value)}><option value="OWN">Usar mis imágenes</option><option value="AI" disabled={!storyStatus?.automaticReady}>Generar imágenes con IA autorizada{!storyStatus?.automaticReady?" · pendiente de configuración":""}</option></select></label>
        <label>Escenas<select className={field} value={sceneCount} onChange={e=>setSceneCount(Number(e.target.value))}>{[6,7,8,9,10,11,12].map(value=><option key={value} value={value}>{value} escenas diferentes</option>)}</select></label>
        <label>Relato completo{generationMode==="AI"&&storyStatus?.scriptReady?" (opcional)":" (necesario con imágenes propias)"}<textarea className={field} rows={5} maxLength={12000} placeholder={`Al menos ${sceneCount} frases y 60 palabras…`} value={narration} onChange={e=>setNarration(e.target.value)}/></label>
        {generationMode==="AI"&&storyStatus?.maxCostUsd!=null&&<p className="text-sm text-amber-200">Límite configurado por historia: USD {storyStatus.maxCostUsd.toFixed(2)}. No se garantiza continuidad perfecta de personajes.</p>}
        <div className="grid gap-4 sm:grid-cols-2"><label>Duración<select className={field} value={custom?"custom":duration} onChange={e=>{setCustom(e.target.value==="custom");setDuration(e.target.value==="custom"?120:Number(e.target.value));}}><option value={30}>30 segundos</option><option value={60}>60 segundos</option><option value={90}>90 segundos</option><option value="custom">Personalizada</option></select>{custom&&<input aria-label="Duración personalizada en segundos" className={field} type="number" min={15} max={300} value={duration} onChange={e=>setDuration(Number(e.target.value))}/>}</label>
          <label>Formato<select className={field} value={format} onChange={e=>setFormat(e.target.value)}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select></label>
          <label>Estilo del manifiesto visual<select className={field} value={style} onChange={e=>setStyle(e.target.value)}><option value="cinematográfico">Cinematográfico</option><option value="ilustración">Ilustración</option><option value="documental">Documental</option></select></label>
          <label>Voz disponible<select className={field} defaultValue="es-419"><option value="es-419">Español latinoamericano · voz local gratuita</option></select></label></div>
        {generationMode==="OWN"&&<label>Imágenes propias en orden ({sceneCount} distintas)<input className={field} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setImages(Array.from(e.target.files||[]).slice(0,12))}/><span className="text-sm text-zinc-400">{images.length} seleccionadas · máximo 4 MB por imagen</span></label>}
        <label>Música opcional<input className={field} type="file" accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" onChange={e=>setMusic(e.target.files?.[0]||null)}/></label>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={rights} onChange={e=>setRights(e.target.checked)}/>Tengo derechos de uso sobre los recursos que subo.</label>
      </>:<><UploadPanel compact onReady={onReady}/>{original&&<p className="text-sm text-emerald-300">Original guardado: {original.originalName}</p>}
        <details><summary className="cursor-pointer py-3 text-violet-200">Ajustar cantidad, duración y movimiento</summary><label>Intensidad de edición<select className={field} value={intensity} onChange={e=>setIntensity(e.target.value)}><option value="GENTLE">Suave</option><option value="NORMAL">Normal</option><option value="DYNAMIC">Dinámica</option></select></label>
        {tool==="MEDIA_CLIPS"&&<div className="grid gap-4 sm:grid-cols-3"><label>Cantidad<input className={field} type="number" min={1} max={10} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Mínimo (segundos)<input className={field} type="number" min={15} max={120} value={minDuration} onChange={e=>setMinDuration(Number(e.target.value))}/></label><label>Máximo (segundos)<input className={field} type="number" min={minDuration} max={180} value={maxDuration} onChange={e=>setMaxDuration(Number(e.target.value))}/></label></div>}</details>
        <p className="text-sm text-zinc-400">Salida vertical que conserva la imagen completa. Los subtítulos utilizan la transcripción de Whisper; revisa nombres y acentos. El tiempo de entrega se medirá con tu material: todavía no hay una estimación comprobada.</p></>}
      {tool!=="URL_IMPORT"&&<><label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={subtitles} onChange={e=>setSubtitles(e.target.checked)}/>Subtítulos blancos con borde oscuro, sin karaoke</label>
      <button type="button" className={button} disabled={busy||(tool!=="MEDIA_STORY"&&!original)||(tool==="MEDIA_STORY"&&generationMode==="AI"&&!storyStatus?.automaticReady)} onClick={()=>void generate()}>{busy?"Guardando recursos…":tool==="MEDIA_STORY"?generationMode==="AI"?"Generar historia con IA":"Crear historia con mis imágenes":tool==="MEDIA_EDIT"?"Edición automática":`Crear ${count} clips`}</button></>}
      {message&&<p role="status" className="text-sm text-emerald-300">{message}</p>}{error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
    </div></section>
    <section aria-label="Mis videos" className="py-8"><h2 className="text-xl font-semibold">Mis videos</h2><p className="mt-2 text-sm text-zinc-400">Cada resultado incluye vista previa y descarga. La comprobación técnica del archivo y la revisión editorial son pasos separados.</p>{historyError&&<p role="alert" className="mt-3 text-sm text-red-300">{historyError}</p>}
      {uploads.filter(upload=>upload.status!=="COMPLETED").map(upload=><div key={upload.id} className="mt-4 rounded-xl border border-white/15 p-4"><p>{upload.name} · {upload.status} · {upload.stage}</p>{upload.error&&<p className="mt-2 text-sm text-red-300">{upload.error}</p>}{upload.status==="FAILED"&&<button type="button" className={`${button} mt-3`} onClick={()=>void request(upload.type==="INGEST_URL"?`/api/ingest/url/${upload.id}`:`/api/videos/jobs/${upload.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"RETRY"})}).then(()=>window.dispatchEvent(new Event("clipforge:project-created"))).catch(failure=>setHistoryError(failure.message))}>Reintentar {upload.type==="INGEST_URL"?"importación":"análisis de la subida"}</button>}</div>)}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{jobs.map(job=><article key={job.id} className="min-w-0 rounded-2xl border border-white/15 p-4"><h3 className="font-semibold">{job.result?.title||TOOLS.find(t=>t[0]===job.type)?.[1]}</h3><p className="mt-1 text-xs text-zinc-400">{new Date(job.createdAt).toLocaleString("es")}</p>
        <p role="status" className="mt-3 break-words text-sm">{STATUS[job.status]||job.status} · {job.stage||job.status}{["PROCESSING","VALIDATING"].includes(job.status)?` · ${job.progress}% de etapas completadas`:""}</p>
        {["PROCESSING","VALIDATING"].includes(job.status)&&<progress aria-label="Etapas completadas" className="mt-2 w-full" value={job.progress} max={100}/>}{job.error&&<p className="mt-2 text-sm text-red-300">{job.error}</p>}
        {["FAILED","WAITING_RESOURCE","CANCELLED"].includes(job.status)&&<button type="button" className={`${button} mt-3`} onClick={()=>void action(job,"retry")}>Reintentar</button>}{["QUEUED","WAITING_RESOURCE"].includes(job.status)&&<button type="button" className="ml-3 min-h-12 px-3 py-3 text-sm" onClick={()=>void action(job,"cancel")}>Cancelar</button>}
        {job.status==="READY"&&job.result&&(job.result.clips||[job.result]).map(output=><div key={output.clipId} className="mt-4">{output.title&&<h4 className="mb-2 font-medium">{output.title}</h4>}<video controls playsInline preload="none" poster={`/api/projects/${job.projectId}/poster`} src={output.sourceUrl} className="max-h-96 w-full rounded-xl bg-black"/>
          <p className="mt-2 text-sm text-zinc-300">{Math.round(output.duration||output.validation?.duration||0)} segundos{output.startTime!==undefined?` · Original: ${Math.round(output.startTime)}–${Math.round(output.endTime||0)} s`:""}</p>{output.reason&&<p className="mt-2 text-sm text-zinc-400">{output.reason}</p>}<p className="mt-2 text-sm text-amber-200">Revisión editorial pendiente: comprueba el mensaje, el encuadre, el audio y los subtítulos antes de entregar.</p><a className="mt-3 inline-block min-h-12 rounded-xl bg-emerald-600 px-5 py-3 font-semibold" href={output.downloadUrl} download>Descargar MP4</a></div>)}
      </article>)}</div>
    </section>
  </>;
}

