'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
type CloudProject={id:string;name:string;savedAt:string;sizeBytes:number;outputCount:number};
type RecoveryRequest={projectId:string;action:string;status:string;error?:string};
export function ProjectRecoveryPanel({projects}:{projects:Array<{id:string;source:{originalName:string}}>}) {
  const[enabled,setEnabled]=useState(false),[remote,setRemote]=useState<CloudProject[]>([]),[requests,setRequests]=useState<RecoveryRequest[]>([]);
  const[error,setError]=useState(''),[busy,setBusy]=useState('');const finished=useRef(new Set<string>());
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch('/api/projects/recovery',{cache:'no-store'}),body=await response.json();
      if(!response.ok)throw new Error(body.error||'No se pudo consultar el respaldo.');
      setEnabled(body.enabled);setRemote(body.projects||[]);setRequests(body.requests||[]);
      for(const request of body.requests||[])if(request.action==='RESTORE'&&request.status==='COMPLETED'&&!finished.current.has(request.projectId)){
        finished.current.add(request.projectId);window.dispatchEvent(new Event('clipforge:project-created'));
      }
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo consultar el respaldo privado.');}
  },[]);
  useEffect(()=>{const first=setTimeout(()=>void refresh(),0),timer=setInterval(()=>{if(!document.hidden)void refresh();},10000);return()=>{clearTimeout(first);clearInterval(timer);};},[refresh]);
  async function request(id:string,action:'BACKUP'|'RESTORE'){
    setBusy(id);setError('');
    try{
      const response=await fetch('/api/projects/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:id,action})}),body=await response.json();
      if(!response.ok)throw new Error(body.error);await refresh();
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo solicitar la operación.');}
    finally{setBusy('');}
  }
  if(!enabled&&!error)return null;
  const missing=remote.filter(p=>!projects.some(local=>local.id===p.id));
  return <section aria-label="Respaldo y recuperación de proyectos" className="my-6 rounded-2xl border border-cyan-400/30 p-4">
    <h3 className="font-semibold">Respaldo privado de proyectos</h3>
    <p className="mt-2 text-sm text-zinc-300">La copia incluye el original, los intervalos y los MP4 terminados. Solo los respaldos confirmados pueden recuperarse después de perder el servidor. Los trabajos recuperados esperan tu reanudación.</p>
    {projects.slice(0,20).map(p=>{
      const saved=remote.find(r=>r.id===p.id),job=requests.find(r=>r.projectId===p.id),pending=job&&['QUEUED','PROCESSING'].includes(job.status);
      return <article key={p.id} className="mt-3 rounded-xl border border-white/15 p-3"><p className="break-words text-sm">{p.source.originalName}</p>
        <p className="mt-1 text-xs text-zinc-400">{pending?'Respaldo solicitado; esperando confirmación del worker.':saved?'Última copia: '+new Date(saved.savedAt).toLocaleString():'Todavía no hay una copia confirmada.'}</p>
        <button type="button" disabled={!!pending||busy===p.id} onClick={()=>void request(p.id,'BACKUP')} className="mt-3 min-h-12 rounded-xl border px-4 py-3 text-sm disabled:opacity-40">Guardar copia del proyecto</button>
        {job?.status==='FAILED'&&<p role="alert" className="mt-2 text-sm text-red-300">{job.error||'El respaldo no se completó; puedes reintentar.'}</p>}
      </article>;
    })}
    {missing.map(p=><article key={p.id} className="mt-3 rounded-xl border border-white/15 p-3"><p className="break-words text-sm">{p.name} · {p.outputCount} MP4 guardados</p>
      <button type="button" disabled={busy===p.id||requests.some(r=>r.projectId===p.id&&['QUEUED','PROCESSING'].includes(r.status))} className="mt-3 min-h-12 rounded-xl bg-cyan-800 px-4 py-3 text-sm disabled:opacity-40" onClick={()=>void request(p.id,'RESTORE')}>Recuperar proyecto del respaldo</button>
      {requests.find(r=>r.projectId===p.id)?.status==='FAILED'&&<p role="alert" className="mt-2 text-sm text-red-300">La recuperación no se completó. Los archivos existentes se conservaron.</p>}
    </article>)}
    {error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
  </section>;
}
