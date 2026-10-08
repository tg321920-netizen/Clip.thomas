"use client";

import { useEffect, useState } from "react";

type AutopilotConfig = {
  enabled: boolean;
  mode: "MANUAL" | "SEMI_AUTO" | "AUTO";
  approvalRequired: boolean;
  postsPerDay: number;
  clipsPerSource: number;
  minClipScore: number;
  minClipDuration: number;
  maxClipDuration: number;
  targetClipDuration: number;
  preferredTimes: string[];
};

export function AutopilotControlPanel() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/autopilot/config", { cache: "no-store" });
        const payload = (await response.json()) as {
          config?: AutopilotConfig;
          error?: string;
        };
        if (!response.ok || !payload.config) {
          throw new Error(payload.error || "No se pudo leer la configuración de Autopilot.");
        }
        if (active) setConfig(payload.config);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudo leer Autopilot.",
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function saveConfig() {
    if (!config || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/autopilot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = (await response.json()) as {
        config?: AutopilotConfig;
        error?: string;
      };
      if (!response.ok || !payload.config) {
        throw new Error(payload.error || "No se pudo guardar Autopilot.");
      }
      setConfig(payload.config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "No se pudo guardar Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <section className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.04] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-300">
          Control de Autopilot
        </h2>
        <p className="mt-3 text-sm text-zinc-500">
          {error || "Cargando configuración real…"}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-300">
            Control de Autopilot
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Cuando está activo, ClipForge avanza transcripción, análisis, varios clips,
            render y programación sin esperar una aprobación técnica entre etapas.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setConfig((current) =>
              current
                ? {
                    ...current,
                    enabled: !current.enabled,
                    mode: current.enabled ? "MANUAL" : "SEMI_AUTO",
                  }
                : current,
            )
          }
          className={`rounded-full px-4 py-2 text-xs font-semibold ${
            config.enabled && config.mode !== "MANUAL"
              ? "bg-emerald-400/15 text-emerald-300"
              : "bg-white/5 text-zinc-400"
          }`}
        >
          {config.enabled && config.mode !== "MANUAL" ? `${config.mode} ON` : "AUTOPILOT OFF"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Clips por fuente"
          value={config.clipsPerSource}
          min={1}
          max={20}
          onChange={(value) => setConfig({ ...config, clipsPerSource: value })}
        />
        <NumberField
          label="Score mínimo"
          value={config.minClipScore}
          min={0}
          max={100}
          onChange={(value) => setConfig({ ...config, minClipScore: value })}
        />
        <NumberField
          label="Duración mínima"
          value={config.minClipDuration}
          min={5}
          max={120}
          onChange={(value) => setConfig({ ...config, minClipDuration: value })}
        />
        <NumberField
          label="Duración máxima"
          value={config.maxClipDuration}
          min={config.minClipDuration}
          max={180}
          onChange={(value) => setConfig({ ...config, maxClipDuration: value })}
        />
        <NumberField
          label="Duración objetivo"
          value={config.targetClipDuration}
          min={config.minClipDuration}
          max={config.maxClipDuration}
          onChange={(value) => setConfig({ ...config, targetClipDuration: value })}
        />
        <NumberField
          label="Publicaciones por día"
          value={config.postsPerDay}
          min={1}
          max={50}
          onChange={(value) => setConfig({ ...config, postsPerDay: value })}
        />
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
        <input
          type="checkbox"
          checked={config.approvalRequired}
          disabled={config.mode === "SEMI_AUTO"}
          onChange={(event) =>
            setConfig({ ...config, approvalRequired: event.target.checked })
          }
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium text-zinc-200">
            Requerir aprobación antes de programar
          </span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500">
            En SEMI_AUTO esta protección permanece activa. Además, la publicación real
            conserva sus guardas de OAuth, canal y servidor.
          </span>
        </span>
      </label>

      <label className="mt-4 block text-xs text-zinc-500">
        Horarios preferidos (HH:MM separados por coma)
        <input
          value={config.preferredTimes.join(", ")}
          onChange={(event) =>
            setConfig({
              ...config,
              preferredTimes: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-zinc-200 outline-none"
        />
      </label>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={busy}
          className="rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar configuración"}
        </button>
        {saved ? <span className="text-sm text-emerald-300">Guardado</span> : null}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          onChange(Math.max(min, Math.min(max, parsed)));
        }}
        className="mt-1 w-full bg-transparent text-lg font-semibold text-zinc-100 outline-none"
      />
    </label>
  );
}
