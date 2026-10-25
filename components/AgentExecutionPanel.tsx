"use client";

import { useCallback, useEffect, useState } from "react";

type AgentExecution = {
  id: string;
  status: string;
  error: string | null;
  stepCount: number;
  updatedAt: string;
  task?: {
    objective?: string;
    autonomyMode?: string;
  };
  pendingDecision?: {
    tool?: string | null;
    reason?: string | null;
  } | null;
};

type AgentPayload = {
  enabled: boolean;
  mode: string;
  providerConfigured: boolean;
  provider?: string;
  model?: string | null;
  editorConfigured?: boolean;
  editorModel?: string;
  editorVision?: boolean;
  executions: AgentExecution[];
  error?: string;
};

export function AgentExecutionPanel() {
  const [payload, setPayload] = useState<AgentPayload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; source: { originalName: string } }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [clipCount, setClipCount] = useState(5);
  const [clipDuration, setClipDuration] = useState(30);
  const [contentProfile, setContentProfile] = useState("ENTERTAINMENT");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/projects", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("No se pudieron cargar los proyectos del agente."); return response.json(); })
      .then(value => setProjects(value.projects || []))
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/executions", { cache: "no-store" });
      const value = (await response.json()) as AgentPayload;
      if (!response.ok) throw new Error(value.error || "No se pudo leer el agente.");
      setPayload(value);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudo leer el agente.",
      );
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function prepareClips() {
    if (busyId || !projectId || !rightsConfirmed) return;
    setBusyId("create"); setError(null); setCreateMessage("");
    try {
      const response = await fetch("/api/agent/executions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        objective: `Prepara hasta ${clipCount} clips distintos de aproximadamente ${clipDuration} segundos del proyecto seleccionado. Prioriza momentos completos y, cuando haya datos de chat, reacciones compartidas por varios participantes aunque repitan el mismo texto. Usa clips.prepare, informa el trabajo encolado y termina. Revisión humana antes de publicar.`,
        autonomyMode: "SEMI_AUTO", projectId, context: { clipping: { count: clipCount, duration: clipDuration, contentProfile, subtitles: true, rightsConfirmed } },
      }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "No se pudo iniciar el agente.");
      setCreateMessage(value.execution?.status === "COMPLETED" ? "Trabajo encolado. El progreso y los MP4 aparecerán en Mis videos cuando termine el procesamiento." : "La ejecución necesita atención. Revisa su estado abajo.");
      window.dispatchEvent(new Event("clipforge:project-created"));
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo iniciar el agente."); }
    finally { setBusyId(null); }
  }

  async function act(executionId: string, action: string) {
    if (busyId) return;
    setBusyId(executionId);
    setError(null);
    try {
      const response = await fetch(
        `/api/agent/executions/${executionId}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "information" ? { note } : {}),
          }),
        },
      );
      const value = (await response.json()) as {
        execution?: AgentExecution;
        error?: string;
      };
      if (!response.ok) throw new Error(value.error || "No se pudo actualizar el agente.");
      if (action === "information") setNote("");
      await refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo actualizar el agente.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.035] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">
            Agente editor
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            El agente corre en el servidor. En SEMI_AUTO prepara el trabajo y se
            detiene cuando necesita aprobación o información del propietario.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300"
        >
          Actualizar
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Badge ok={payload?.enabled === true} text={payload?.enabled ? "CICLOS AUTOMÁTICOS ON" : "INICIO MANUAL"} />
        <Badge ok={payload?.providerConfigured === true} text={payload?.providerConfigured ? `${payload.provider || "zai"}: CONFIGURADO` : "FALTA CONFIGURAR API"} />
        <span className="rounded-full bg-white/5 px-3 py-1.5 text-zinc-400">
          {payload?.mode || "—"}
        </span>
      </div>

      <fieldset aria-label="Preparar clips con el agente" className="mt-5 grid min-w-0 gap-4 rounded-xl border border-white/10 p-4">
        <legend className="px-2 text-sm font-semibold text-zinc-200">Preparar clips para revisión</legend>
        <p className="text-sm text-zinc-400">Elegí un video ya importado o subido. El editor combina transcripción, señales medidas y, si está configurado, fotogramas. La publicación sigue desactivada.</p>
        {payload && (!payload.providerConfigured || !payload.editorConfigured) && <p role="status" className="text-sm text-amber-200">Falta configurar la clave de API del servidor. El análisis manual sigue disponible.</p>}
        {payload?.editorConfigured && <p className="break-words text-xs text-zinc-400">Editor: {payload.editorModel} · {payload.editorVision ? "Transcripción y fotogramas" : "Transcripción; fotogramas desactivados"}</p>}
        <label className="min-w-0 text-sm">Video original<select aria-label="Video original para el agente" value={projectId} onChange={event => { setProjectId(event.target.value); setRightsConfirmed(false); }} className="mt-2 min-h-12 w-full min-w-0 max-w-full rounded-xl bg-zinc-900 px-3 text-base"><option value="">Seleccionar video</option>{projects.map(project => <option key={project.id} value={project.id}>{project.source.originalName}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Máximo de clips<select aria-label="Cantidad de clips del agente" value={clipCount} onChange={event => setClipCount(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl bg-zinc-900 px-3 text-base">{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>
          <label className="text-sm">Duración<select aria-label="Duración de clips del agente" value={clipDuration} onChange={event => setClipDuration(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl bg-zinc-900 px-3 text-base">{[15,30,45,60,90].map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}</select></label>
        </div>
        <p className="text-sm text-zinc-400">Podés pedir más de cinco clips, hasta diez por lote. Se preparan menos si faltan momentos completos y diferentes. Las reacciones repetidas por varios participantes pueden ayudar a elegirlos cuando hay datos del chat.</p>
        <label className="text-sm">Tipo de contenido<select aria-label="Perfil de clips del agente" value={contentProfile} onChange={event => setContentProfile(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl bg-zinc-900 px-3 text-base">{[["ENTERTAINMENT","Entretenimiento"],["GAMING","Gaming"],["PODCAST","Podcast"],["NEWS","Noticias"],["MOTIVATION","Motivación"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} className="h-5 w-5 shrink-0"/>Tengo autorización para procesar este video y enviarlo al proveedor de IA.</label>
        <button type="button" onClick={() => void prepareClips()} disabled={Boolean(busyId) || !projectId || !rightsConfirmed || !payload?.providerConfigured || !payload?.editorConfigured} className="min-h-12 rounded-xl bg-cyan-600 px-4 py-3 text-base font-semibold disabled:opacity-40">{busyId === "create" ? "Preparando…" : `Preparar ${clipCount} clips con IA`}</button>
        {createMessage && <p role="status" className="text-sm text-cyan-200">{createMessage}</p>}
      </fieldset>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        {!payload ? (
          <p className="text-sm text-zinc-500">Cargando ejecuciones…</p>
        ) : payload.executions.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no hay ejecuciones del agente.</p>
        ) : (
          payload.executions.slice(0, 10).map((execution) => (
            <div key={execution.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">
                    {execution.task?.objective || "Tarea del agente"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {execution.task?.autonomyMode || "—"} · {execution.status} · paso {execution.stepCount || 0}
                  </p>
                </div>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                  {formatDate(execution.updatedAt)}
                </span>
              </div>

              {execution.pendingDecision?.tool ? (
                <p className="mt-3 text-xs text-zinc-400">
                  Acción pendiente: {execution.pendingDecision.tool}
                </p>
              ) : null}
              {execution.error ? (
                <p className="mt-2 text-xs leading-5 text-amber-300/80">
                  {execution.error}
                </p>
              ) : null}

              {execution.status === "WAITING_APPROVAL" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === execution.id}
                    onClick={() => void act(execution.id, "approve")}
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Aprobar y continuar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === execution.id}
                    onClick={() => void act(execution.id, "cancel")}
                    className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}

              {execution.status === "WAITING_INFORMATION" ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Información para que el agente continúe"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-200 outline-none"
                  />
                  <button
                    type="button"
                    disabled={busyId === execution.id || !note.trim()}
                    onClick={() => void act(execution.id, "information")}
                    className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Enviar y continuar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === execution.id}
                    onClick={() => void act(execution.id, "cancel")}
                    className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={`rounded-full px-3 py-1.5 ${
        ok ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {text}
    </span>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
