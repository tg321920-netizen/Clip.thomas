"use client";

import { useMemo, useState } from "react";

type Brand = { id: string; name: string };
type FactoryView = {
  channel: {
    id: string;
    name: string;
    platform: string;
    status: string;
    publishingEnabled: boolean;
    dailyLimit: number;
    timezone: string;
    strategy?: { systemPrompt?: string; dailyPostLimit?: number };
  };
  profile: {
    enabled: boolean;
    brandId: string | null;
    language: string;
    niche: string;
    recipeKey: string;
    editTemplate: { framingMode: string; quality: string; subtitleStyle: string };
    preferredTimes: string[];
  };
  status: Record<string, number>;
  performance: {
    publishedCount: number;
    measuredCount: number;
    totals: Record<string, number>;
    engagementRate: number | null;
  };
  realPublishingEnabled: boolean;
};

type Dashboard = {
  channels: FactoryView[];
  totals: Record<string, number>;
  realPublishingEnabled: boolean;
};

export default function ContentFactoryBoard({ initialData, brands }: { initialData: Dashboard; brands: Brand[] }) {
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  const totals = useMemo(() => data.totals || {}, [data]);

  async function save(view: FactoryView, form: HTMLFormElement) {
    setSaving(view.channel.id);
    setMessage((current) => ({ ...current, [view.channel.id]: "" }));
    const values = new FormData(form);
    const body = {
      enabled: values.get("enabled") === "on",
      brandId: String(values.get("brandId") || "") || null,
      language: String(values.get("language") || "es"),
      niche: String(values.get("niche") || ""),
      recipeKey: String(values.get("recipeKey") || "VIDEO_TO_CLIPS"),
      postsPerDay: Number(values.get("postsPerDay") || 0),
      preferredTimes: String(values.get("preferredTimes") || "").split(",").map((item) => item.trim()).filter(Boolean),
      editTemplate: {
        framingMode: String(values.get("framingMode") || "FILL"),
        quality: String(values.get("quality") || "BALANCED"),
        subtitleStyle: String(values.get("subtitleStyle") || "VIRAL"),
      },
      strategy: { systemPrompt: String(values.get("systemPrompt") || "") },
    };

    try {
      const response = await fetch(`/api/content-factory/${view.channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar.");
      const refresh = await fetch("/api/content-factory", { cache: "no-store" });
      const refreshed = await refresh.json();
      if (refresh.ok) setData(refreshed);
      setMessage((current) => ({ ...current, [view.channel.id]: "Guardado" }));
    } catch (error) {
      setMessage((current) => ({ ...current, [view.channel.id]: error instanceof Error ? error.message : "Error al guardar" }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Pendiente" value={totals.pending || 0} />
        <Stat label="Procesando" value={totals.processing || 0} />
        <Stat label="Aprobación" value={totals.waitingApproval || 0} />
        <Stat label="Listo" value={totals.ready || 0} />
        <Stat label="Programado" value={totals.scheduled || 0} />
        <Stat label="Publicado" value={totals.published || 0} />
        <Stat label="Fallido" value={totals.failed || 0} />
      </section>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <span className="text-zinc-400">REAL PUBLISHING: </span>
        <span className={data.realPublishingEnabled ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"}>
          {data.realPublishingEnabled ? "ON" : "OFF"}
        </span>
        <p className="mt-1 text-xs text-zinc-600">OFF mantiene la fábrica en preparación, aprobación, programación y DRY RUN sin publicar automáticamente.</p>
      </div>

      {data.channels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">No hay canales configurados. Crea o conecta un canal en Conexiones.</div>
      ) : data.channels.map((view) => (
        <form
          key={view.channel.id}
          className="rounded-2xl border border-white/10 bg-white/[0.015] p-4 sm:p-5"
          onSubmit={(event) => { event.preventDefault(); void save(view, event.currentTarget); }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-zinc-100">{view.channel.name}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{view.channel.platform} · {view.channel.status} · {view.channel.timezone}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input name="enabled" type="checkbox" defaultChecked={view.profile.enabled} className="h-4 w-4" />
              Fábrica activa
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Pendiente" value={view.status.pending} />
            <Mini label="Procesando" value={view.status.processing} />
            <Mini label="Aprobación" value={view.status.waitingApproval} />
            <Mini label="Listo" value={view.status.ready} />
            <Mini label="Programado" value={view.status.scheduled} />
            <Mini label="Publicado" value={view.status.published} />
            <Mini label="Fallido" value={view.status.failed} />
            <Mini label="Vistas" value={view.performance.totals?.views || 0} />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Marca">
              <select name="brandId" defaultValue={view.profile.brandId || ""} className={control}>
                <option value="">Sin marca</option>
                {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </Field>
            <Field label="Idioma"><input name="language" defaultValue={view.profile.language} className={control} /></Field>
            <Field label="Nicho"><input name="niche" defaultValue={view.profile.niche} className={control} placeholder="Gaming, noticias, negocios…" /></Field>
            <Field label="Workflow">
              <select name="recipeKey" defaultValue={view.profile.recipeKey} className={control}>
                <option value="VIDEO_TO_CLIPS">Video → clips</option>
                <option value="PRODUCT_TO_AD">Producto → anuncio</option>
                <option value="COMPANY_WEEK_CONTENT">Empresa → semana</option>
                <option value="URL_TO_CONTENT">URL → contenido</option>
              </select>
            </Field>
            <Field label="Publicaciones por día"><input name="postsPerDay" type="number" min="0" max="50" defaultValue={view.channel.dailyLimit} className={control} /></Field>
            <Field label="Horas preferidas"><input name="preferredTimes" defaultValue={view.profile.preferredTimes.join(", ")} className={control} placeholder="09:00, 15:00, 20:00" /></Field>
            <Field label="Encuadre">
              <select name="framingMode" defaultValue={view.profile.editTemplate.framingMode} className={control}><option value="FILL">FILL</option><option value="FIT">FIT</option></select>
            </Field>
            <Field label="Calidad">
              <select name="quality" defaultValue={view.profile.editTemplate.quality} className={control}><option value="FAST">FAST</option><option value="BALANCED">BALANCED</option><option value="HIGH">HIGH</option></select>
            </Field>
            <Field label="Subtítulos">
              <select name="subtitleStyle" defaultValue={view.profile.editTemplate.subtitleStyle} className={control}><option value="CLEAN">CLEAN</option><option value="VIRAL">VIRAL</option><option value="KARAOKE">KARAOKE</option></select>
            </Field>
            <Field label="Rendimiento">
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                {view.performance.publishedCount} publicados · {view.performance.measuredCount} medidos · engagement {view.performance.engagementRate === null ? "—" : `${(view.performance.engagementRate * 100).toFixed(1)}%`}
              </div>
            </Field>
          </div>

          <Field label="Estrategia del canal">
            <textarea name="systemPrompt" defaultValue={view.channel.strategy?.systemPrompt || ""} rows={3} className={`${control} mt-1 resize-y`} placeholder="Reglas editoriales, tono, audiencia y objetivos del canal." />
          </Field>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">{message[view.channel.id] || (view.channel.publishingEnabled ? "Canal habilitado para publicar tras sus controles." : "Publicación del canal desactivada.")}</p>
            <button disabled={saving === view.channel.id} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving === view.channel.id ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}

const control = "w-full rounded-xl border border-white/10 bg-[#0c0d12] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-400/50";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-medium text-zinc-500"><span className="mb-1 block">{label}</span>{children}</label>; }
function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-white/10 p-3"><p className="text-xl font-semibold">{value}</p><p className="text-[11px] text-zinc-500">{label}</p></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-white/[0.03] px-3 py-2"><p className="text-base font-semibold">{value}</p><p className="text-[10px] text-zinc-500">{label}</p></div>; }
