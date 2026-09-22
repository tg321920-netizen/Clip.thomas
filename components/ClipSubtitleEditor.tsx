"use client";

import { useState } from "react";
import type {
  ClipRecord,
  SubtitleCue,
  SubtitleStyle,
  SubtitleTrack,
} from "@/types/clip";

type SubtitleResponse = {
  subtitles?: SubtitleTrack;
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
          }),
        },
      );

      const payload = (await response.json()) as SubtitleResponse;
      if (!response.ok || !payload.subtitles) {
        throw new Error(payload.error || "No se pudieron generar los subtítulos.");
      }

      setTrack(payload.subtitles);
      setStyle(payload.subtitles.style);
      setEnabled(payload.subtitles.enabled);
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

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy !== null}
          className="mt-3 w-full rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-400/15 disabled:opacity-40"
        >
          {busy === "generate"
            ? "Generando…"
            : "Generar subtítulos y volver a renderizar"}
        </button>

        {error && (
          <p className="mt-2 text-xs leading-5 text-red-300">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
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
  );
}
