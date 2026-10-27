"use client";
import { useEffect, useState } from 'react';

export function TranslationGlossary({ projectId }: { projectId: string }) {
  const [text,setText] = useState(''), [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [loaded,setLoaded] = useState(false);
  useEffect(()=>{let active=true;void fetch(`/api/projects/${projectId}`).then(async response=>{
    const data=await response.json(); if (!response.ok) throw new Error(data.error || 'No se pudo cargar el glosario.');
    if (active) {setText((data.translationSettings?.glossary || []).map((term:{source:string;target:string})=>`${term.source} = ${term.target}`).join('\n'));setLoaded(true);}
  }).catch(error=>{if(active)setMessage(error.message);});return()=>{active=false;};},[projectId]);
  async function save(){setBusy(true);setMessage('');try{
    const glossary=text.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const at=line.indexOf('=');if(at<1)throw new Error('Usa original = traducción, un término por línea.');return{source:line.slice(0,at).trim(),target:line.slice(at+1).trim()};});
    const response=await fetch(`/api/projects/${projectId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({glossary})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo guardar.');
    setMessage('Glosario guardado. Aplicar idioma y renderizar lo usará en una nueva traducción; las versiones previas se conservan.');
  }catch(error){setMessage(error instanceof Error?error.message:'No se pudo guardar.');}finally{setBusy(false);}}
  return <details className="mt-3 rounded-lg border border-white/20 p-3"><summary className="min-h-12 cursor-pointer py-3 text-sm">Glosario de traducción del proyecto</summary>
    <p className="text-sm text-zinc-300">Nombres propios y términos técnicos. Un término por línea, por ejemplo: NASA = NASA. Se aplica a las nuevas traducciones de este proyecto.</p>
    <textarea aria-label="Glosario de traducción" rows={5} maxLength={18000} value={text} disabled={!loaded||busy} onChange={event=>setText(event.target.value)} className="mt-3 w-full rounded-lg border border-white/20 bg-zinc-950 p-3 text-base"/>
    <button type="button" disabled={!loaded||busy} onClick={()=>void save()} className="mt-3 min-h-12 rounded-lg border border-cyan-300/40 px-4 text-sm disabled:opacity-40">{busy?'Guardando…':'Guardar glosario'}</button>
    {message&&<p role="status" className="mt-2 text-sm text-amber-200">{message}</p>}
  </details>;
}
