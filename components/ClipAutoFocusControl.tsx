"use client";

import { useState } from "react";
import type { ClipRecord } from "@/types/clip";

type AutoFocusResponse = {
  autoReframe?: ClipRecord["autoReframe"];
  error?: string;
};

export function ClipAutoFocusControl({
  projectId,
  clip,
  onChanged,
}: {
  projectId: string;
  clip: ClipRecord;
  onChanged: () => Promise<void>;
}) {
  const [zoom, setZoom] = useState(
    String(clip.autoReframe?.zoom || 1.12),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(
    clip.edit.autoReframeEnabled && clip.autoReframe?.enabled,
  );

  async function apply(nextEnabled: boolean) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/clips/${clip.id}/auto-reframe`,
        {
          method: nextEnabled ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: nextEnabled,
            zoom: Number(zoom),
          }),
        },
      );

      const payload = (await response.json()) as AutoFocusResponse;
      if (!response.ok) {
        throw new Error(payload.error || "No se pudo cambiar Auto Focus.");
      }

      await onChanged();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo cambiar Auto Focus.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-300">
            Auto Focus al hablar
          </p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-600">
            Hace zoom suave cuando Whisper detecta voz. Esta primera versión
            está optimizada para streamer individual o sujeto centrado.
          </p>
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            enabled
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-zinc-500"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <label className="text-[10px] uppercase tracking-wide text-zinc-600">
          Zoom máximo
          <select
            value={zoom}
            onChange={(event) => setZoom(event.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-950 px-2 py-2 text-xs normal-case text-zinc-300"
          >
            <option value="1.08">Suave · 1.08×</option>
            <option value="1.12">Normal · 1.12×</option>
            <option value="1.18">Fuerte · 1.18×</option>
            <option value="1.24">Muy fuerte · 1.24×</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => void apply(!enabled)}
          disabled={busy}
          className="self-end rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Procesando…" : enabled ? "Desactivar" : "Activar"}
        </button>
      </div>

      {enabled && clip.autoReframe && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
          <span>{clip.autoReframe.windows.length} tramos de voz</span>
          <span>·</span>
          <span>{clip.autoReframe.zoom.toFixed(2)}×</span>
          <span>·</span>
          <span>zoom progresivo</span>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs leading-5 text-red-300">{error}</p>
      )}
    </div>
  );
}
