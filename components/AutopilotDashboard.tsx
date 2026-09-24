"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type DashboardData = {
  generatedAt: string;
  config: {
    enabled: boolean;
    mode: "MANUAL" | "AUTOPILOT";
    approvalRequired: boolean;
    postsPerDay: number;
    platforms: string[];
    preferredTimes: string[];
    analyticsEnabled: boolean;
    learningEnabled: boolean;
  };
  summary: {
    connectedChannels: number;
    publishingChannels: number;
    todayPosts: number;
    approvalCount: number;
    upcomingCount: number;
    queueCount: number;
    errorCount: number;
    publishedTotal: number;
  };
  aiUsage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    knownEstimatedCostUsd: number;
    unknownCostRequests: number;
  };
  channels: Array<{
    id: string;
    platform: string;
    name: string;
    status: string;
    publishingEnabled: boolean;
    dailyLimit: number;
    timezone: string;
  }>;
  queue: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    attempts: number;
    error: string | null;
  }>;
  approvals: Array<{
    id: string;
    platform: string;
    title: string;
    createdAt: string;
  }>;
  upcoming: Array<{
    id: string;
    platform: string;
    title: string;
    scheduledAt: string;
  }>;
  errors: {
    publications: Array<{
      id: string;
      platform: string;
      title: string;
      error: string | null;
    }>;
    jobs: Array<{
      id: string;
      type: string;
      error: string | null;
    }>;
  };
  performance: {
    sampleCount: number;
    recommendations: Array<{
      id: string;
      type: string;
      confidence: string;
      text: string;
      autoApply: boolean;
    }>;
    disclaimer: string;
  };
};

export function AutopilotDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/autopilot/dashboard", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo cargar Autopilot.");
      }
      setData(payload as DashboardData);
      if (!silent) setError(null);
    } catch (loadError) {
      if (!silent) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar Autopilot.",
        );
      }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(() => {
      void load(true);
    }, 10_000);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  async function setAutopilotEnabled(enabled: boolean) {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/autopilot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          mode: enabled ? "AUTOPILOT" : "MANUAL",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo cambiar Autopilot.");
      }
      await load(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo cambiar Autopilot.",
      );
    } finally {
      setSaving(false);
    }
  }

  const errors = useMemo(
    () =>
      (data?.errors.publications.length || 0) + (data?.errors.jobs.length || 0),
    [data],
  );

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-sm text-zinc-400">
        {error || "Cargando estado real de Autopilot…"}
      </div>
    );
  }

  const active = data.config.enabled && data.config.mode === "AUTOPILOT";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  active ? "bg-emerald-400" : "bg-zinc-600"
                }`}
              />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                {active ? "Autopilot activo" : "Autopilot manual"}
              </p>
            </div>
            <h2 className="mt-2 text-xl font-semibold">Centro de operaciones</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {data.config.approvalRequired
                ? "Los clips esperan aprobación antes de programarse."
                : "Los clips aprobados por la política pueden programarse automáticamente."}
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void setAutopilotEnabled(!active)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
              active
                ? "border border-white/10 bg-white/[0.06] text-zinc-200 hover:bg-white/10"
                : "bg-violet-500 text-white hover:bg-violet-400"
            }`}
          >
            {saving ? "Guardando…" : active ? "Pasar a manual" : "Activar Autopilot"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Canales listos" value={data.summary.publishingChannels} />
          <Metric label="Posts hoy" value={data.summary.todayPosts} />
          <Metric label="En cola" value={data.summary.queueCount} />
          <Metric label="Errores" value={errors} danger={errors > 0} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Canales conectados" subtitle={`${data.summary.connectedChannels} conectados`}>
          {data.channels.length === 0 ? (
            <Empty text="Todavía no hay canales configurados." />
          ) : (
            <div className="space-y-2">
              {data.channels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{channel.name}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {channel.platform} · {channel.timezone} · máx. {channel.dailyLimit}/día
                    </p>
                  </div>
                  <Status
                    ok={channel.status === "CONNECTED" && channel.publishingEnabled}
                    text={
                      channel.status === "CONNECTED" && channel.publishingEnabled
                        ? "Listo"
                        : channel.status
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Cola de trabajo" subtitle={`${data.summary.queueCount} activos`}>
          {data.queue.length === 0 ? (
            <Empty text="No hay trabajos esperando ni procesándose." />
          ) : (
            <div className="space-y-2">
              {data.queue.slice(0, 8).map((job) => (
                <div key={job.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-zinc-300">{job.type}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">Intento {job.attempts}</p>
                    </div>
                    <span className="text-xs text-violet-300">{Math.round(job.progress)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-violet-500 transition-[width]"
                      style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Esperando aprobación" subtitle={`${data.summary.approvalCount} clips`}>
          {data.approvals.length === 0 ? (
            <Empty text="No hay publicaciones pendientes de aprobación." />
          ) : (
            <div className="space-y-2">
              {data.approvals.slice(0, 8).map((publication) => (
                <PublicationRow
                  key={publication.id}
                  platform={publication.platform}
                  title={publication.title}
                  meta="Pendiente de aprobación"
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Próximas publicaciones" subtitle={`${data.summary.upcomingCount} programadas`}>
          {data.upcoming.length === 0 ? (
            <Empty text="No hay publicaciones futuras programadas." />
          ) : (
            <div className="space-y-2">
              {data.upcoming.slice(0, 8).map((publication) => (
                <PublicationRow
                  key={publication.id}
                  platform={publication.platform}
                  title={publication.title}
                  meta={formatDate(publication.scheduledAt)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Uso de IA"
        subtitle={`${data.aiUsage.requests} solicitudes registradas`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Tokens totales" value={data.aiUsage.totalTokens} />
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-zinc-600">Costo estimado conocido</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-100">
              ${data.aiUsage.knownEstimatedCostUsd.toFixed(4)}
            </p>
          </div>
          <Metric label="Costos sin tarifa" value={data.aiUsage.unknownCostRequests} />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-zinc-600">
          El costo solo se calcula cuando configuraste tarifas por millón de tokens; ClipForge no inventa precios.
        </p>
      </Panel>

      <Panel
        title="Aprendizaje de rendimiento"
        subtitle={`${data.performance.sampleCount} publicaciones con métricas`}
      >
        <div className="space-y-3">
          {data.performance.recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              className="rounded-xl border border-violet-400/15 bg-violet-400/[0.06] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-400">
                  {recommendation.type}
                </span>
                <span className="text-[10px] uppercase text-zinc-600">
                  Confianza {recommendation.confidence.toLowerCase()}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-300">{recommendation.text}</p>
            </div>
          ))}
          <p className="text-[11px] leading-5 text-zinc-600">{data.performance.disclaimer}</p>
        </div>
      </Panel>

      {errors > 0 && (
        <Panel title="Errores que requieren atención" subtitle={`${errors} encontrados`}>
          <div className="space-y-2">
            {data.errors.publications.slice(0, 6).map((publication) => (
              <div key={publication.id} className="rounded-xl border border-red-400/15 bg-red-400/[0.06] p-3">
                <p className="text-xs font-medium text-red-200">
                  {publication.platform} · {publication.title}
                </p>
                <p className="mt-1 text-xs text-red-300/70">{publication.error || "Fallo de publicación"}</p>
              </div>
            ))}
            {data.errors.jobs.slice(0, 6).map((job) => (
              <div key={job.id} className="rounded-xl border border-red-400/15 bg-red-400/[0.06] p-3">
                <p className="text-xs font-medium text-red-200">{job.type}</p>
                <p className="mt-1 text-xs text-red-300/70">{job.error || "Fallo del worker"}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-zinc-600">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${danger ? "text-red-300" : "text-zinc-100"}`}>
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-medium text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-600">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function PublicationRow({
  platform,
  title,
  meta,
}: {
  platform: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">{platform}</p>
      <p className="mt-1 truncate text-sm text-zinc-300">{title}</p>
      <p className="mt-1 text-[11px] text-zinc-600">{meta}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl bg-black/20 p-4 text-sm text-zinc-600">{text}</p>;
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${
        ok
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : "border-white/10 bg-white/5 text-zinc-500"
      }`}
    >
      {text}
    </span>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date)
    : value;
}
