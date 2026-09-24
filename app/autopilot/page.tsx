import Link from "next/link";
import { AnalyticsService } from "@/services/analytics/AnalyticsService.mjs";
import { PerformanceAnalyzer } from "@/services/analytics/PerformanceAnalyzer.mjs";
import { ChannelService } from "@/services/channels/ChannelService.mjs";
import { PublicationService } from "@/services/publications/PublicationService.mjs";
import { AIUsageService } from "@/services/usage/AIUsageService.mjs";
import type { ChannelRecord } from "@/types/channel";
import type { PublicationRecord } from "@/types/publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PerformanceRecommendation = {
  type: string;
  message: string;
};

type PerformanceReport = {
  measuredCount: number;
  sampleNotice: string | null;
  recommendations: PerformanceRecommendation[];
};

export default async function AutopilotDashboard() {
  const publications = new PublicationService();
  const channelsService = new ChannelService();
  const analytics = new AnalyticsService({ publications });
  const performance = new PerformanceAnalyzer({ publications, analytics });
  const usage = new AIUsageService();

  const [rawPublications, rawChannels, analyticsSummary, rawReport, usageSummary] =
    await Promise.all([
      publications.list(),
      channelsService.listChannels(),
      analytics.summarize(),
      performance.analyze(),
      usage.summarize(),
    ]);

  const allPublications = rawPublications as PublicationRecord[];
  const channels = rawChannels as ChannelRecord[];
  const report = rawReport as PerformanceReport;

  const waiting = allPublications.filter(
    (item: PublicationRecord) => item.status === "WAITING_APPROVAL",
  );
  const errors = allPublications.filter(
    (item: PublicationRecord) => item.status === "FAILED",
  );
  const upcoming = allPublications
    .filter(
      (item: PublicationRecord) =>
        item.status === "SCHEDULED" &&
        Number.isFinite(Date.parse(item.scheduledAt || "")),
    )
    .sort((a: PublicationRecord, b: PublicationRecord) =>
      Date.parse(a.scheduledAt || "") - Date.parse(b.scheduledAt || ""),
    )
    .slice(0, 8);
  const connectedChannels = channels.filter(
    (channel: ChannelRecord) =>
      channel.status === "CONNECTED" && channel.publishingEnabled,
  );

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
              ClipForge Autopilot
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Estado real de automatización, publicaciones y aprendizaje
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition hover:bg-white/5"
          >
            Volver a proyectos
          </Link>
        </header>

        <section className="grid gap-3 py-8 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Canales listos" value={connectedChannels.length} />
          <StatCard label="Esperando aprobación" value={waiting.length} />
          <StatCard label="Publicadas" value={analyticsSummary.publishedCount} />
          <StatCard label="Con métricas" value={analyticsSummary.measuredCount} />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Panel title="Publicaciones programadas">
            {upcoming.length === 0 ? (
              <Empty text="No hay publicaciones programadas pendientes." />
            ) : (
              <div className="space-y-3">
                {upcoming.map((item: PublicationRecord) => (
                  <div key={item.id} className="rounded-xl border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.platform} · {item.channelId.slice(0, 8)}
                        </p>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {formatDate(item.scheduledAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Rendimiento">
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric
                label="Vistas medidas"
                value={formatNumber(analyticsSummary.totals.views)}
              />
              <MiniMetric
                label="Cobertura analytics"
                value={`${Math.round(analyticsSummary.coverage * 100)}%`}
              />
              <MiniMetric
                label="Engagement"
                value={
                  analyticsSummary.engagementRate === null
                    ? "—"
                    : `${(analyticsSummary.engagementRate * 100).toFixed(2)}%`
                }
              />
              <MiniMetric
                label="Muestra aprendizaje"
                value={String(report.measuredCount)}
              />
            </div>
            {report.sampleNotice ? (
              <p className="mt-4 text-sm leading-6 text-amber-300/80">
                {report.sampleNotice}
              </p>
            ) : null}
          </Panel>

          <Panel title="Recomendaciones con evidencia">
            {report.recommendations.length === 0 ? (
              <Empty text="Todavía no hay evidencia suficiente para recomendar cambios." />
            ) : (
              <div className="space-y-3">
                {report.recommendations.slice(0, 6).map(
                  (recommendation: PerformanceRecommendation) => (
                    <div
                      key={recommendation.type}
                      className="rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">
                        {recommendation.type}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {recommendation.message}
                      </p>
                    </div>
                  ),
                )}
              </div>
            )}
          </Panel>

          <Panel title="IA y costos registrados">
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric label="Operaciones" value={String(usageSummary.records)} />
              <MiniMetric
                label="Tokens"
                value={formatNumber(usageSummary.totalTokens)}
              />
              <MiniMetric
                label="Costo estimado"
                value={`$${usageSummary.estimatedCostUsd.toFixed(4)}`}
              />
              <MiniMetric
                label="Cobertura costo"
                value={`${Math.round(usageSummary.costCoverage * 100)}%`}
              />
            </div>
            {usageSummary.note ? (
              <p className="mt-4 text-xs leading-5 text-zinc-500">{usageSummary.note}</p>
            ) : null}
          </Panel>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel title="Errores de publicación">
            {errors.length === 0 ? (
              <Empty text="No hay publicaciones en estado FAILED." />
            ) : (
              <div className="space-y-3">
                {errors.slice(0, 8).map((item: PublicationRecord) => (
                  <div key={item.id} className="rounded-xl border border-red-400/15 p-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-red-300/80">
                      {item.error || "Fallo sin detalle registrado."}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Canales">
            {channels.length === 0 ? (
              <Empty text="Todavía no hay canales configurados." />
            ) : (
              <div className="space-y-3">
                {channels.map((channel: ChannelRecord) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/10 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{channel.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{channel.platform}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        channel.status === "CONNECTED" && channel.publishingEnabled
                          ? "bg-emerald-400/10 text-emerald-300"
                          : "bg-white/5 text-zinc-400"
                      }`}
                    >
                      {channel.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-5 text-zinc-600">
          El dashboard solo muestra datos persistidos por ClipForge. No simula métricas,
          publicaciones ni costos ausentes.
        </p>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm leading-6 text-zinc-500">{text}</p>;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es").format(Math.round(value || 0));
}
