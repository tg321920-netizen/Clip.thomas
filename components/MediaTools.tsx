"use client";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";
import type { UploadedVideo } from "@/types/video";

type Tool = "MEDIA_STORY" | "MEDIA_EDIT" | "MEDIA_CLIPS";
type Output = { clipId: string; title?: string; sourceUrl: string; downloadUrl: string; duration?: number; startTime?: number; endTime?: number; reason?: string; validation?: { duration: number } };
type Job = { id: string; projectId: string; type: Tool; createdAt: string; status: string; stage: string; progress: number; error?: string; result?: Output & { clips?: Output[] } };
const TOOLS: [Tool,string,string][] = [["MEDIA_STORY","CREAR HISTORIA CON IA","Idea → Imágenes → Voz → MP4"],["MEDIA_EDIT","EDITAR VIDEO AUTOMÁTICAMENTE","Subir → Cortar silencios → MP4"],["MEDIA_CLIPS","SACAR MEJORES CLIPS","Subir video largo → Elegir momentos → MP4"]];
const field = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-zinc-900 px-3 py-3 text-base text-white";
const button = "min-h-12 rounded-xl bg-violet-500 px-5 py-3 text-base font-semibold text-white disabled:opacity-40";
async function request(url: string, init?: RequestInit) { const response = await fetch(url,init); const body = await response.json(); if (!response.ok) throw new Error(body.error || body.message || "No se pudo completar la operación."); return body; }
async function uploadAsset(file: File) { if (file.size > 4*1024*1024) throw new Error(`${file.name} supera 4 MB.`); return (await request("/api/media/assets",{method:"POST",headers:{"Content-Type":file.type || "application/octet-stream","X-Rights-Confirmed":"true"},body:file})).relativePath as string; }

export function MediaTools() {
  const [tool,setTool] = useState<Tool>("MEDIA_STORY");
  const [topic,setTopic] = useState("Una ciudad maya perdida en la selva, con misterio y narración en español.");
  const [narration,setNarration] = useState(""); const [duration,setDuration] = useState(60); const [custom,setCustom] = useState(false);
  const [format,setFormat] = useState("9:16"); const [style,setStyle] = useState("cinematográfico");
  const [images,setImages] = useState<File[]>([]); const [music,setMusic] = useState<File|null>(null); const [example,setExample] = useState(true); const [rights,setRights] = useState(false);
  const [subtitles,setSubtitles] = useState(true); const [original,setOriginal] = useState<UploadedVideo|null>(null); const [intensity,setIntensity] = useState("NORMAL");
  const [count,setCount] = useState(3); const [minDuration,setMinDuration] = useState(90); const [maxDuration,setMaxDuration] = useState(180);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [error,setError] = useState(""); const [jobs,setJobs] = useState<Job[]>([]); const [historyError,setHistoryError] = useState("");
  const onReady = useCallback((video: UploadedVideo) => setOriginal(video),[]);
  useEffect(() => {
    let active=true, fetching=false; let timer: ReturnType<typeof setTimeout>;
    const refresh=async()=>{ if(fetching)return; fetching=true; try {const body=await request("/api/media/jobs",{cache:"no-store"}); if(active){setJobs(body.jobs||[]);setHistoryError("");}} catch(failure){if(active)setHistoryError(failure instanceof Error?failure.message:"No se pudo cargar el historial.");} finally{fetching=false;if(active)timer=setTimeout(()=>void refresh(),document.hidden?15000:4000);} };
    const notify=()=>{clearTimeout(timer);void refresh();}; void refresh(); window.addEventListener("clipforge:project-created",notify);
    return()=>{active=false;clearTimeout(timer);window.removeEventListener("clipforge:project-created",notify);};
  },[]);
  async function generate(){setBusy(true);setError("");setMessage("");try{
    let payload: Record<string,unknown>;
    if(tool==="MEDIA_STORY"){
      if((images.length||music)&&!rights)throw new Error("Confirma que tienes derechos sobre las imágenes y la música.");
      if(!example&&images.length<6)throw new Error("Elige al menos seis imágenes distintas.");
      const paths:string[]=[];
      if(example){setMessage("Preparando las seis imágenes originales del ejemplo…");paths.push(...(await request("/api/media/example",{method:"POST"})).images);}
      else for(const image of images){paths.push(await uploadAsset(image));setMessage(`Imágenes guardadas: ${paths.length}/${images.length}`);}
      payload={topic,narration,duration,format,style,images:paths,subtitles,music:music?await uploadAsset(music):undefined};
    }else{if(!original)throw new Error("Primero sube y analiza el video original.");payload={projectId:original.projectId,intensity,subtitles,count,minDuration,maxDuration,format:"9:16"};}
    const body=await request("/api/media/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:tool,id:crypto.randomUUID(),payload})});
    setJobs(previous=>[body.job,...previous.filter(j=>j.id!==body.job.id)]);setMessage("Trabajo guardado. Puedes cerrar la página y consultar el resultado en Mis videos.");window.dispatchEvent(new Event("clipforge:project-created"));
  }catch(failure){setError(failure instanceof Error?failure.message:"No se pudo iniciar el trabajo.");}finally{setBusy(false);}}
  async function action(job:Job,value:string){try{const body=await request(`/api/media/jobs/${job.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:value})});setJobs(previous=>previous.map(j=>j.id===job.id?body.job:j));}catch(failure){setHistoryError(failure instanceof Error?failure.message:"No se pudo actualizar el trabajo.");}}
  return <>
    <nav aria-label="Herramientas de video" className="grid gap-3 py-6 md:grid-cols-3">{TOOLS.map(([id,title,description])=><button key={id} type="button" aria-pressed={tool===id} onClick={()=>{setTool(id);setError("");setMessage("");}} className={`min-h-28 rounded-2xl border p-5 text-left ${tool===id?"border-violet-400 bg-violet-500/20":"border-white/15 bg-white/5"}`}><span className="block font-bold">{title}</span><span className="mt-2 block text-sm text-zinc-300">{description}</span></button>)}</nav>
    <section aria-label={TOOLS.find(t=>t[0]===tool)?.[1]} className="rounded-3xl border border-white/15 bg-white/5 p-5 sm:p-7"><h2 className="mb-5 text-xl font-semibold">{TOOLS.find(t=>t[0]===tool)?.[1]}</h2><div className="grid gap-5">
      {tool==="MEDIA_STORY"?<>
        <label>Tema o idea<textarea className={field} rows={3} maxLength={2000} value={topic} onChange={e=>setTopic(e.target.value)}/></label>
        <p className="text-sm leading-6 text-zinc-300">El ejemplo maya incluye un relato original y seis imágenes preparadas para ClipForge. Para otros temas, pega tu relato y utiliza imágenes propias. La generación externa necesita un proveedor autorizado.</p>
        <label>Relato completo (opcional para el ejemplo)<textarea className={field} rows={5} maxLength={12000} placeholder="Al menos seis frases y 60 palabras…" value={narration} onChange={e=>setNarration(e.target.value)}/></label>
        <div className="grid gap-4 sm:grid-cols-2"><label>Duración<select className={field} value={custom?"custom":duration} onChange={e=>{setCustom(e.target.value==="custom");setDuration(e.target.value==="custom"?120:Number(e.target.value));}}><option value={30}>30 segundos</option><option value={60}>60 segundos</option><option value={90}>90 segundos</option><option value="custom">Personalizada</option></select>{custom&&<input aria-label="Duración personalizada en segundos" className={field} type="number" min={15} max={300} value={duration} onChange={e=>setDuration(Number(e.target.value))}/>}</label>
          <label>Formato<select className={field} value={format} onChange={e=>setFormat(e.target.value)}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select></label>
          <label>Estilo del manifiesto visual<select className={field} value={style} onChange={e=>setStyle(e.target.value)}><option value="cinematográfico">Cinematográfico</option><option value="ilustración">Ilustración</option><option value="documental">Documental</option></select></label>
          <label>Voz disponible<select className={field} defaultValue="es-419"><option value="es-419">Español latinoamericano · voz local gratuita</option></select></label></div>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={example} onChange={e=>setExample(e.target.checked)}/>Usar las seis imágenes del ejemplo maya</label>
        {!example&&<label>Imágenes propias en orden (seis distintas)<input className={field} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setImages(Array.from(e.target.files||[]).slice(0,12))}/><span className="text-sm text-zinc-400">{images.length} seleccionadas · máximo 4 MB por imagen</span></label>}
        <label>Música opcional<input className={field} type="file" accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" onChange={e=>setMusic(e.target.files?.[0]||null)}/></label>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={rights} onChange={e=>setRights(e.target.checked)}/>Tengo derechos de uso sobre los recursos que subo.</label>
      </>:<><UploadPanel compact onReady={onReady}/>{original&&<p className="text-sm text-emerald-300">Original guardado: {original.originalName}</p>}
        <label>Intensidad de edición<select className={field} value={intensity} onChange={e=>setIntensity(e.target.value)}><option value="GENTLE">Suave</option><option value="NORMAL">Normal</option><option value="DYNAMIC">Dinámica</option></select></label>
        {tool==="MEDIA_CLIPS"&&<div className="grid gap-4 sm:grid-cols-3"><label>Cantidad<input className={field} type="number" min={1} max={10} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Mínimo (segundos)<input className={field} type="number" min={15} max={120} value={minDuration} onChange={e=>setMinDuration(Number(e.target.value))}/></label><label>Máximo (segundos)<input className={field} type="number" min={minDuration} max={180} value={maxDuration} onChange={e=>setMaxDuration(Number(e.target.value))}/></label></div>}
        <p className="text-sm text-zinc-400">Salida vertical que conserva la imagen completa. Los subtítulos utilizan la transcripción real de Whisper.</p></>}
      <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={subtitles} onChange={e=>setSubtitles(e.target.checked)}/>Subtítulos blancos con borde oscuro, sin karaoke</label>
      <button type="button" className={button} disabled={busy||(tool!=="MEDIA_STORY"&&!original)} onClick={()=>void generate()}>{busy?"Guardando recursos…":tool==="MEDIA_STORY"?"Generar historia":tool==="MEDIA_EDIT"?"Edición automática":"Generar mejores clips"}</button>
      {message&&<p role="status" className="text-sm text-emerald-300">{message}</p>}{error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
    </div></section>
    <section aria-label="Mis videos" className="py-8"><h2 className="text-xl font-semibold">Mis videos</h2><p className="mt-2 text-sm text-zinc-400">El estado se consulta al servidor. READY requiere archivos MP4 comprobados.</p>{historyError&&<p role="alert" className="mt-3 text-sm text-red-300">{historyError}</p>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{jobs.map(job=><article key={job.id} className="min-w-0 rounded-2xl border border-white/15 p-4"><h3 className="font-semibold">{job.result?.title||TOOLS.find(t=>t[0]===job.type)?.[1]}</h3><p className="mt-1 text-xs text-zinc-400">{new Date(job.createdAt).toLocaleString("es")}</p>
        <p role="status" className="mt-3 break-words text-sm">{job.status} · {job.stage||job.status}{["PROCESSING","VALIDATING"].includes(job.status)?` · ${job.progress}% de etapas completadas`:""}</p>
        {["PROCESSING","VALIDATING"].includes(job.status)&&<progress aria-label="Etapas completadas" className="mt-2 w-full" value={job.progress} max={100}/>}{job.error&&<p className="mt-2 text-sm text-red-300">{job.error}</p>}
        {["FAILED","WAITING_RESOURCE","CANCELLED"].includes(job.status)&&<button type="button" className={`${button} mt-3`} onClick={()=>void action(job,"retry")}>Reintentar</button>}{["QUEUED","WAITING_RESOURCE"].includes(job.status)&&<button type="button" className="ml-3 min-h-12 px-3 py-3 text-sm" onClick={()=>void action(job,"cancel")}>Cancelar</button>}
        {job.status==="READY"&&job.result&&(job.result.clips||[job.result]).map(output=><div key={output.clipId} className="mt-4">{output.title&&<h4 className="mb-2 font-medium">{output.title}</h4>}<video controls playsInline preload="none" poster={`/api/projects/${job.projectId}/poster`} src={output.sourceUrl} className="max-h-96 w-full rounded-xl bg-black"/>
          <p className="mt-2 text-sm text-zinc-300">{Math.round(output.duration||output.validation?.duration||0)} segundos{output.startTime!==undefined?` · Original: ${Math.round(output.startTime)}–${Math.round(output.endTime||0)} s`:""}</p>{output.reason&&<p className="mt-2 text-sm text-zinc-400">{output.reason}</p>}<a className="mt-3 inline-block min-h-12 rounded-xl bg-emerald-600 px-5 py-3 font-semibold" href={output.downloadUrl} download>Descargar MP4</a></div>)}
      </article>)}</div>
    </section>
  </>;
}
