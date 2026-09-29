"use client";

import { useMemo, useState } from "react";

type VariantPreview = {
  id: string;
  label: string;
  angle: string;
  title: string;
  hook: string;
  description: string;
  cta: string;
};

type ApprovalItem = {
  id: string;
  projectId: string | null;
  subjectType: string;
  subjectId: string;
  title: string;
  message: string;
  createdAt: string;
  variants?: VariantPreview[];
};

type Props = {
  initialApprovals: ApprovalItem[];
  unreadNotifications: number;
};

export function ApprovalInbox({ initialApprovals, unreadNotifications }: Props) {
  const [items, setItems] = useState(initialApprovals);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pendingCount = useMemo(() => items.length, [items]);

  async function decide(item: ApprovalItem, action: "approve" | "modify" | "reject") {
    const variants = item.variants || [];
    const selectedVariantId = selected[item.id] || "";
    const note = (notes[item.id] || "").trim();

    if (action === "approve" && variants.length > 1 && !selectedVariantId) {
      setMessage("Elegí una variante antes de aprobar.");
      return;
    }
    if (action === "modify" && !note) {
      setMessage("Escribí qué querés modificar antes de enviar la solicitud de cambios.");
      return;
    }

    setBusyId(item.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/approvals/${item.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(selectedVariantId ? { selectedVariantId } : {}),
          ...(note ? { note } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar la decisión.");

      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setMessage(
        action === "approve"
          ? "Aprobado. El contenido quedó listo para continuar al siguiente paso."
          : action === "modify"
            ? "Cambios solicitados. La pieza salió de la bandeja pendiente."
            : "Rechazado. No se continuará con esta pieza.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la decisión.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3">
        <Metric label="Pendientes" value={pendingCount} />
        <Metric label="Notificaciones sin leer" value={unreadNotifications} />
      </section>

      {message ? (
        <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.07] px-4 py-3 text-sm leading-6 text-violet-100">
          {message}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center">
          <p className="text-base font-semibold text-zinc-200">No hay nada esperando aprobación.</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Cuando una campaña, pieza o acción necesite tu decisión aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const variants = item.variants || [];
            const busy = busyId === item.id;
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 shadow-2xl shadow-black/10 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-300">
                      {humanSubject(item.subjectType)}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-100">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{item.message}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                    Pendiente
                  </span>
                </div>

                {variants.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Elegí la variante
                    </p>
                    {variants.map((variant) => {
                      const checked = selected[item.id] === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => setSelected((current) => ({ ...current, [item.id]: variant.id }))}
                          className={`w-full rounded-xl border p-3 text-left transition ${
                            checked
                              ? "border-violet-400/60 bg-violet-400/[0.09]"
                              : "border-white/10 bg-black/10 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-zinc-100">
                              Variante {variant.label} · {humanAngle(variant.angle)}
                            </p>
                            <span
                              className={`h-4 w-4 rounded-full border ${
                                checked ? "border-violet-300 bg-violet-400" : "border-zinc-600"
                              }`}
                            />
                          </div>
                          <p className="mt-2 text-sm font-medium text-zinc-300">{variant.title}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{variant.hook}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">{variant.description}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <label className="mt-5 block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Nota o cambios
                  </span>
                  <textarea
                    value={notes[item.id] || ""}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    rows={3}
                    placeholder="Opcional al aprobar o rechazar. Obligatorio si pedís modificar."
                    className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/40"
                  />
                </label>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(item, "approve")}
                    className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(item, "modify")}
                    className="rounded-xl border border-amber-300/30 bg-amber-300/[0.06] px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Modificar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(item, "reject")}
                    className="rounded-xl border border-red-400/25 bg-red-400/[0.05] px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-400/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-2xl font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{label}</p>
    </div>
  );
}

function humanSubject(value: string) {
  if (value === "CONTENT_GENERATION") return "Contenido";
  if (value === "PUBLICATION") return "Publicación";
  if (value === "BUDGET") return "Presupuesto";
  if (value === "CONNECTION") return "Conexión";
  if (value === "DELETION") return "Eliminación";
  if (value === "INFORMATION") return "Información";
  if (value === "WORKFLOW_EXECUTION") return "Automatización";
  return value.replaceAll("_", " ");
}

function humanAngle(value: string) {
  if (value === "PROBLEM") return "Problema";
  if (value === "DEMONSTRATION") return "Demostración";
  if (value === "BENEFIT") return "Beneficio";
  return value;
}
