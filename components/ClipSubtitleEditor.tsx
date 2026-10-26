"use client";

import { useState } from "react";
import { ClipAutoFocusControl } from "@/components/ClipAutoFocusControl";
import type {
  ClipRecord,
  SubtitleCue,
  SubtitleStyle,
  SubtitleTrack,
  SubtitleMode,
} from "@/types/clip";

type SubtitleResponse = {
  subtitles?: SubtitleTrack | null;
  job?: { id: string };
  error?: string;
};

export function ClipSubtitleEditor({
  projectId,
  clip,
  onRenderNeeded,
}: {
  projectId: string;
  clip: ClipRecord;
  onRenderNeeded: () => Promise<void>;
}) {
  const [track, setTrack] = useState<SubtitleTrack | null>(clip.subtitles);
  const [style, setStyle] = useState<SubtitleStyle>(
    clip.subtitles?.style || clip.edit.subtitleStyle || "CLEAN",
  );
  const [enabled, setEnabled] = useState(
    clip.subtitles?.enabled ?? clip.edit.subtitlesEnabled ?? false,
  );
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SubtitleMode>(clip.edit.subtitleMode || (clip.subtitles?.language === 'en' ? 'ORIGINAL_EN' : 'ORIGINAL_ES'));
  const modeControls = <label className="mt-3 block text-sm">Idioma de subtítulos<select aria-label="Idioma de subtítulos" className="mt-2 min-h-12 w-full rounded-lg border border-white/20 bg-zinc-950 px-3 text-base" value={mode} disabled={busy !== null} onChange={event=>setMode(event.target.value as SubtitleMode)}><option value="NONE">Sin subtítulos</option><option value="ORIGINAL_ES">Español → español</option><option value="ORIGINAL_EN">Inglés → inglés</option><option value="TRANSLATE_ES">Inglés → español traducido</option></select></label>;

  async function generate() {
    setBusy("generate");
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/clips/${clip.id}/subtitles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            style,
            enabled: true,
            mode,
          }),
        },
      );

      const payload = (await response.json()) as SubtitleResponse;
      if (!response.ok || (!payload.subtitles && !payload.job)) {
        throw new Error(payload.error || "No se pudieron generar los subtítulos.");
      }

      if (payload.subtitles) {
        setTrack(payload.subtitles);
        setStyle(payload.subtitles.style);
        setEnabled(payload.subtitles.enabled);
      }
      await onRenderNeeded();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudieron generar los subtítulos.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!track) return;

    setBusy("save");
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/clips/${clip.id}/subtitles`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            style,
            enabled,
            cues: track.cues,
          }),
        },
      );

      const payload = (await response.json()) as SubtitleResponse;
      if (!response.ok || !payload.subtitles) {
        throw new Error(payload.error || "No se pudieron guardar los subtítulos.");
      }

      setTrack(payload.subtitles);
      await onRenderNeeded();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudieron guardar los subtítulos.",
      );
    } finally {
      setBusy(null);
    }
  }

  function updateCue(
    cueId: string,
    patch: Partial<Pick<SubtitleCue, "text" | "startTime" | "endTime">>,
  ) {
    if (!track) return;

    setTrack({
      ...track,
      cues: track.cues.map((cue) =>
        cue.id === cueId
          ? {
              ...cue,
              ...patch,
              words: undefined,
            }
          : cue,
      ),
    });
  }

  if (!track) {
    return (
      <>
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-300">Subtítulos</p>
              <p className="mt-1 text-[11px] leading-5 text-zinc-600">
                Se generan desde los timestamps reales de Whisper.
              </p>
            </div>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value as SubtitleStyle)}
              disabled={busy !== null}
              className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300"
            >
              <option value="CLEAN">CLEAN</option>
              <option value="VIRAL">VIRAL</option>
              <option value="KARAOKE">KARAOKE</option>
            </select>
          </div>

          {modeControls}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== null}
            className="mt-3 w-full rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-40"
          >
            {busy === "generate"
              ? "Generando…"
              : "Aplicar idioma y renderizar"}
          </button>

          {error && (
            <p className="mt-2 text-xs leading-5 text-red-300">{error}</p>
          )}
        </div>

        <ClipAutoFocusControl
          projectId={projectId}
          clip={clip}
          onChanged={onRenderNeeded}
        />
      </>
    );
  }

  return (
    <>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
        {modeControls}
        <button type="button" disabled={busy !== null} className="mt-3 min-h-12 w-full rounded-lg border border-violet-400/40 px-3 py-3 text-sm" onClick={()=>void generate()}>Aplicar idioma y renderizar</button>
        <a className="mt-3 inline-block min-h-12 py-3 text-sm text-cyan-200" href={`/api/projects/${projectId}/clips/${clip.id}/subtitles?format=srt`} download>Descargar subtítulos SRT</a>
        {track.translation && <p className="mt-2 text-sm text-amber-200">Traducción local al español · revisión pendiente. Tiempos basados en las frases originales, sin doblaje ni sincronización medida por palabra traducida.</p>}
        {track.sourceCues && <details className="mt-3 rounded-lg border border-amber-300/30 p-3"><summary className="min-h-12 cursor-pointer py-3 text-sm">Comparar con el texto inglés original</summary><p className="text-sm text-amber-200">Comprueba nombres propios, cifras y negaciones. La transcripción también puede contener errores.</p>{track.sourceCues.map(cue=><p key={cue.id} className="mt-2 text-sm text-zinc-300">{cue.startTime.toFixed(1)}–{cue.endTime.toFixed(1)} s · {cue.text}</p>)}</details>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-zinc-300">Subtítulos editables</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              {track.cues.length} bloques · cambios no destructivos
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={busy !== null}
              />
              Activos
            </label>

            <select
              value={style}
              onChange={(event) => setStyle(event.target.value as SubtitleStyle)}
              disabled={busy !== null}
              className="rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300"
            >
              <option value="CLEAN">CLEAN</option>
              <option value="VIRAL">VIRAL</option>
              <option value="KARAOKE">KARAOKE</option>
            </select>
          </div>
        </div>

        <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
          {track.cues.map((cue) => (
            <div
              key={cue.id}
              className="rounded-lg border border-white/10 bg-white/[0.035] p-2"
            >
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] uppercase tracking-wide text-zinc-600">
                  Inicio
                  <input
                    type="number"
                    min={0}
                    max={clip.duration}
                    step={0.05}
                    value={cue.startTime}
                    onChange={(event) =>
                      updateCue(cue.id, {
                        startTime: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs normal-case text-zinc-300"
                  />
                </label>

                <label className="text-[10px] uppercase tracking-wide text-zinc-600">
                  Fin
                  <input
                    type="number"
                    min={0}
                    max={clip.duration}
                    step={0.05}
                    value={cue.endTime}
                    onChange={(event) =>
                      updateCue(cue.id, {
                        endTime: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs normal-case text-zinc-300"
                  />
                </label>
              </div>

              <textarea
                aria-label={`Texto del subtítulo ${cue.id}`}
                value={cue.text}
                onChange={(event) =>
                  updateCue(cue.id, { text: event.target.value })
                }
                rows={2}
                maxLength={300}
                className="mt-2 w-full resize-y rounded-md border border-white/10 bg-zinc-950 px-2 py-2 text-xs leading-5 text-zinc-300"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="mt-3 w-full rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
        >
          {busy === "save"
            ? "Guardando…"
            : "Guardar y volver a renderizar"}
        </button>

        {error && (
          <p className="mt-2 text-xs leading-5 text-red-300">{error}</p>
        )}
      </div>

      <ClipAutoFocusControl
        projectId={projectId}
        clip={clip}
        onChanged={onRenderNeeded}
      />
    </>
  );
}
