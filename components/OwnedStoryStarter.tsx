"use client";

import { useMemo, useState } from "react";

type ChannelOption = {
  id: string;
  name: string;
  platform: string;
  lineKey: string | null;
  language: string;
  defaultFormat: string;
  enabled: boolean;
};

type SourceDraft = {
  type: "TEXT" | "URL";
  value: string;
  title: string;
  authorized: boolean;
};

export default function OwnedStoryStarter({ channels }: { channels: ChannelOption[] }) {
  const enabled = useMemo(() => channels.filter((channel) => channel.enabled && channel.lineKey), [channels]);
  const [channelId, setChannelId] = useState(enabled[0]?.id || "");
  const selected = enabled.find((channel) => channel.id === channelId) || enabled[0] || null;
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [format, setFormat] = useState(selected?.defaultFormat || "SHORT");
  const [first, setFirst] = useState<SourceDraft>({ type: "TEXT", value: "", title: "Fuente 1", authorized: false });
  const [second, setSecond] = useState<SourceDraft>({ type: "TEXT", value: "", title: "Fuente 2", authorized: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [approvalId, setApprovalId] = useState<string | null>(null);

  async function submit() {
    if (!selected) return;
    const source1 = buildSource(first);
    const source2 = buildSource(second);
    if (!topic.trim() || !source1 || !source2) {
      setResult("Escribe el tema y dos fuentes completas.");
      return;
    }
    if ((first.type === "URL" && !first.authorized) || (second.type === "URL" && !second.authorized)) {
      setResult("Para una URL debes confirmar que puede consultarse como fuente de investigación. Esto no concede derechos sobre sus imágenes o video.");
      return;
    }

    setBusy(true);
    setResult("");
    setApprovalId(null);
    try {
      const response = await fetch(`/api/content-factory/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          category,
          format,
          idempotencyKey: `owned:${selected.id}:${topic.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80)}:${new Date().toISOString().slice(0, 10)}`,
          sources: [source1, source2],
          ttsMode: "TTS_FREE",
          trendSignal: {
            observedAt: new Date().toISOString(),
            sourceCount: 2,
            originalityPotential: 70,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo iniciar la historia.");
      const status = payload?.run?.execution?.status || payload?.execution?.status || "queued";
      const approval = payload?.run?.approval?.id || payload?.approval?.id || null;
      setApprovalId(approval);
      if (payload?.mediaJob) {
        setResult(`Investigación iniciada. La parte multimedia quedó en cola del runtime de medios. Estado: ${status}.`);
      } else if (status === "waiting_approval") {
        setResult("Pieza renderizada y detenida en aprobación humana. Revisa el Gate antes de aprobar.");
      } else {
        setResult(`Workflow iniciado. Estado: ${status}.`);
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Error al iniciar la historia.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled.length === 0) {
    return <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Primero activa un canal propio y asigna US NEWS EN, LATAM NEWS ES o ENTERTAINMENT / GOSSIP ES en Content Factory.</div>;
  }

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.015] p-4 sm:p-5">
      <div>
        <p className="text-sm font-semibold text-zinc-100">Nueva historia</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">Este formulario inicia investigación con dos fuentes. No publica nada automáticamente y usa TTS gratuito por defecto.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Canal">
          <select value={channelId} onChange={(event) => { setChannelId(event.target.value); const next = enabled.find((item) => item.id === event.target.value); if (next) setFormat(next.defaultFormat || "SHORT"); }} className={control}>
            {enabled.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.lineKey}</option>)}
          </select>
        </Field>
        <Field label="Formato">
          <select value={format} onChange={(event) => setFormat(event.target.value)} className={control}>
            <option value="SHORT">SHORT</option><option value="MEDIUM">MEDIUM</option><option value="LONG">LONG</option>
          </select>
        </Field>
        <Field label="Tema / acontecimiento">
          <input value={topic} onChange={(event) => setTopic(event.target.value)} className={control} placeholder="Qué ocurrió o qué tema investigar" />
        </Field>
        <Field label="Categoría">
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={control}>
            <option value="GENERAL">GENERAL</option><option value="BREAKING">BREAKING</option><option value="ECONOMY">ECONOMY</option><option value="TECH">TECH</option><option value="SPORTS">SPORTS</option><option value="ENTERTAINMENT">ENTERTAINMENT</option>
          </select>
        </Field>
      </div>

      <SourceEditor label="Fuente 1" value={first} onChange={setFirst} />
      <SourceEditor label="Fuente 2" value={second} onChange={setSecond} />

      <div className="rounded-xl border border-amber-400/10 bg-amber-400/[0.03] p-3 text-xs leading-5 text-zinc-500">
        Una URL se usa únicamente para investigar/extractar hechos. No convierte imágenes, audio o video de esa página en material reutilizable. Esos recursos deben pasar por Rights Guard por separado.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">{result || `${selected?.platform || ""} · ${selected?.language || ""} · REAL PUBLISHING permanece OFF salvo activación explícita.`}</p>
        <div className="flex gap-2">
          {approvalId ? <a href="/approvals" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300">Revisar aprobación</a> : null}
          <button type="button" onClick={() => void submit()} disabled={busy} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Iniciando…" : "Investigar y crear"}</button>
        </div>
      </div>
    </div>
  );
}

function SourceEditor({ label, value, onChange }: { label: string; value: SourceDraft; onChange: (value: SourceDraft) => void }) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <Field label={label}>
          <select value={value.type} onChange={(event) => onChange({ ...value, type: event.target.value as SourceDraft["type"], value: "", authorized: false })} className={control}>
            <option value="TEXT">Texto / notas</option><option value="URL">URL</option>
          </select>
        </Field>
        <Field label="Nombre de la fuente"><input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} className={control} /></Field>
      </div>
      <div className="mt-3">
        {value.type === "TEXT" ? (
          <textarea value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} rows={5} className={`${control} resize-y`} placeholder="Pega aquí hechos/notas de una fuente independiente. No pegues un artículo completo si no es necesario." />
        ) : (
          <>
            <input value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} className={control} placeholder="https://..." />
            <label className="mt-2 flex items-start gap-2 text-xs leading-5 text-zinc-500"><input type="checkbox" checked={value.authorized} onChange={(event) => onChange({ ...value, authorized: event.target.checked })} className="mt-1" /><span>Confirmo que esta URL puede consultarse como fuente de investigación. Esto no autoriza reutilizar su multimedia.</span></label>
          </>
        )}
      </div>
    </div>
  );
}

function buildSource(draft: SourceDraft) {
  const value = draft.value.trim();
  if (!value) return null;
  if (draft.type === "URL") {
    return {
      type: "URL",
      url: value,
      authorizationConfirmed: draft.authorized,
      authorizationBasis: "User confirmed this URL may be consulted as a research source; no multimedia reuse rights are implied.",
      metadata: { title: draft.title.trim() || "Research URL" },
    };
  }
  return { type: "TEXT", text: value, metadata: { title: draft.title.trim() || "Research notes" } };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-zinc-500"><span className="mb-1 block">{label}</span>{children}</label>;
}
const control = "w-full rounded-xl border border-white/10 bg-[#0c0d12] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-400/50";
