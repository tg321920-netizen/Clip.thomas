"use client";

import { useMemo, useState } from "react";

type ChannelOption = {
  id: string;
  name: string;
  platform: string;
  lineKey: string | null;
  enabled: boolean;
};

type Trend = {
  id: string;
  channelId: string;
  topic: string;
  category: string;
  state: "LOW" | "RISING" | "VIRAL" | "SATURATED";
  score: number;
  signals: {
    relevance: number;
    recency: number;
    growth: number;
    saturation: number;
    sourceAvailability: number;
    sourceCount: number;
    originalityPotential: number;
    historyFit: number;
  };
  selectedAt: string | null;
  createdAt: string;
};

export default function TrendHunterBoard({
  channels,
  initialTrends,
}: {
  channels: ChannelOption[];
  initialTrends: Trend[];
}) {
  const enabled = useMemo(
    () => channels.filter((channel) => channel.enabled && channel.lineKey),
    [channels],
  );
  const [channelId, setChannelId] = useState(enabled[0]?.id || "");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [sourceCount, setSourceCount] = useState(2);
  const [growthScore, setGrowthScore] = useState(50);
  const [saturationScore, setSaturationScore] = useState(30);
  const [originalityPotential, setOriginalityPotential] = useState(70);
  const [historyFitScore, setHistoryFitScore] = useState(50);
  const [trends, setTrends] = useState(initialTrends);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function classify() {
    if (!channelId || !topic.trim()) {
      setMessage("Selecciona un canal y escribe el tema.");
      return;
    }
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch("/api/content-factory/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          topic: topic.trim(),
          category,
          sourceCount,
          growthScore,
          saturationScore,
          originalityPotential,
          historyFitScore,
          observedAt: new Date().toISOString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo clasificar la tendencia.");
      setTrends((current) => [payload as Trend, ...current.filter((item) => item.id !== payload.id)]);
      setTopic("");
      setMessage(`Clasificada como ${payload.state} con score ${payload.score}. Aún requiere selección humana.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al clasificar la tendencia.");
    } finally {
      setBusy(null);
    }
  }

  async function selectTrend(trend: Trend) {
    setBusy(trend.id);
    setMessage("");
    try {
      const response = await fetch(`/api/content-factory/trends/${trend.id}/select`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo seleccionar la tendencia.");
      setTrends((current) => current.map((item) => item.id === trend.id ? payload as Trend : item));
      setMessage("Tendencia seleccionada. Ahora puedes convertirla en una historia investigada con múltiples fuentes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al seleccionar la tendencia.");
    } finally {
      setBusy(null);
    }
  }

  if (enabled.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm leading-6 text-zinc-500">
        Trend Hunter necesita al menos un canal propio activo con una línea asignada. Configúralo primero en Content Factory.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/[0.015] p-4 sm:p-5">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Registrar señal</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Trend Hunter puntúa oportunidades; no publica ni crea historias automáticamente. Los valores pueden venir de observación manual o de conectores gratuitos futuros.
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Canal">
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)} className={control}>
              {enabled.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.lineKey}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={control}>
              <option value="GENERAL">GENERAL</option>
              <option value="BREAKING">BREAKING</option>
              <option value="ECONOMY">ECONOMY</option>
              <option value="TECH">TECH</option>
              <option value="SPORTS">SPORTS</option>
              <option value="ENTERTAINMENT">ENTERTAINMENT</option>
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Tema / señal detectada">
            <input value={topic} onChange={(event) => setTopic(event.target.value)} className={control} placeholder="Qué tema está creciendo" maxLength={240} />
          </Field>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <NumberField label="Fuentes" value={sourceCount} min={0} max={20} onChange={setSourceCount} />
          <NumberField label="Crecimiento" value={growthScore} onChange={setGrowthScore} />
          <NumberField label="Saturación" value={saturationScore} onChange={setSaturationScore} />
          <NumberField label="Originalidad" value={originalityPotential} onChange={setOriginalityPotential} />
          <NumberField label="Historial" value={historyFitScore} onChange={setHistoryFitScore} />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-zinc-600">Crecimiento, saturación, originalidad e historial usan escala 0–100. La relevancia se calcula también con el nicho y estrategia del canal.</p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">{message || "LOW, RISING, VIRAL y SATURATED son señales de decisión, no órdenes de publicación."}</p>
          <button type="button" disabled={busy === "create"} onClick={() => void classify()} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "create" ? "Clasificando…" : "Clasificar señal"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        {trends.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">Todavía no hay señales registradas.</div>
        ) : trends.map((trend) => {
          const channel = channels.find((item) => item.id === trend.channelId);
          const query = new URLSearchParams({
            channelId: trend.channelId,
            topic: trend.topic,
            category: trend.category,
            trendId: trend.id,
            sourceCount: String(trend.signals.sourceCount),
            growthScore: String(trend.signals.growth),
            saturationScore: String(trend.signals.saturation),
            originalityPotential: String(trend.signals.originalityPotential),
          }).toString();
          return (
            <article key={trend.id} className="rounded-2xl border border-white/10 bg-white/[0.015] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StateBadge state={trend.state} />
                    <span className="text-xs text-zinc-500">Score {trend.score}</span>
                    {trend.selectedAt ? <span className="text-xs text-emerald-400">Seleccionada</span> : null}
                  </div>
                  <p className="mt-2 font-medium text-zinc-100">{trend.topic}</p>
                  <p className="mt-1 text-xs text-zinc-500">{channel?.name || trend.channelId} · {trend.category} · {new Date(trend.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!trend.selectedAt ? (
                    <button type="button" disabled={busy === trend.id} onClick={() => void selectTrend(trend)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-50">
                      {busy === trend.id ? "Seleccionando…" : "Seleccionar"}
                    </button>
                  ) : (
                    <a href={`/factory/new?${query}`} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white">Crear historia</a>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Mini label="Relevancia" value={trend.signals.relevance} />
                <Mini label="Actualidad" value={trend.signals.recency} />
                <Mini label="Crecimiento" value={trend.signals.growth} />
                <Mini label="Saturación" value={trend.signals.saturation} />
                <Mini label="Fuentes" value={trend.signals.sourceCount} />
                <Mini label="Originalidad" value={trend.signals.originalityPotential} />
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function StateBadge({ state }: { state: Trend["state"] }) {
  const classes = state === "VIRAL"
    ? "bg-emerald-400/10 text-emerald-300"
    : state === "RISING"
      ? "bg-sky-400/10 text-sky-300"
      : state === "SATURATED"
        ? "bg-amber-400/10 text-amber-300"
        : "bg-white/5 text-zinc-400";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${classes}`}>{state}</span>;
}

function NumberField({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <Field label={label}><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))} className={control} /></Field>;
}
function Mini({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-white/[0.03] px-2 py-2"><p className="text-sm font-semibold">{value}</p><p className="text-[10px] text-zinc-600">{label}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-zinc-500"><span className="mb-1 block">{label}</span>{children}</label>; }
const control = "w-full rounded-xl border border-white/10 bg-[#0c0d12] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-400/50";
