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
  executions: AgentExecution[];
  error?: string;
};

export function AgentExecutionPanel() {
  const [payload, setPayload] = useState<AgentPayload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

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
            Agente Z.ai
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
        <Badge ok={payload?.enabled === true} text={payload?.enabled ? "AGENTE ON" : "AGENTE OFF"} />
        <Badge ok={payload?.providerConfigured === true} text={payload?.providerConfigured ? "Z.AI CONFIGURADO" : "Z.AI SIN CONFIGURAR"} />
        <span className="rounded-full bg-white/5 px-3 py-1.5 text-zinc-400">
          {payload?.mode || "—"}
        </span>
      </div>

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
