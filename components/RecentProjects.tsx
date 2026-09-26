"use client";

import { useEffect, useState } from "react";
import type { UploadedVideo } from "@/types/video";

type ProjectRecord = {
  id: string;
  createdAt: string;
  source: UploadedVideo;
};

const PROJECT_OPEN_EVENT = "clipforge:project-open";

export function RecentProjects() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) throw new Error("projects");
        const payload = (await response.json()) as { projects?: ProjectRecord[] };
        if (!active) return;
        setProjects(payload.projects ?? []);
      } catch {
        // The upload experience remains usable even if history cannot load.
      } finally {
        if (active) setLoaded(true);
      }
    };

    void load();

    const refresh = () => {
      void load();
    };

    window.addEventListener("clipforge:project-created", refresh);

    return () => {
      active = false;
      window.removeEventListener("clipforge:project-created", refresh);
    };
  }, []);

  function openProject(project: ProjectRecord) {
    window.dispatchEvent(
      new CustomEvent<UploadedVideo>(PROJECT_OPEN_EVENT, {
        detail: project.source,
      }),
    );

    requestAnimationFrame(() => {
      document.getElementById("clipforge-upload-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  if (!loaded || projects.length === 0) return null;

  return (
    <section className="border-t border-white/10 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Proyectos
          </p>
          <h2 className="mt-1 text-lg font-medium">Recientes</h2>
        </div>
        <span className="text-xs text-zinc-600">{projects.length} guardados</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {projects.slice(0, 6).map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => openProject(project)}
            className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-violet-400/30 hover:bg-violet-500/[0.06] focus:outline-none focus:ring-2 focus:ring-violet-400/50"
            aria-label={`Abrir proyecto ${project.source.originalName}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {project.source.originalName}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatDate(project.createdAt)}
                </p>
              </div>
              <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-zinc-400">
                {project.source.width}×{project.source.height}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
              <span>{formatDuration(project.source.durationSeconds)}</span>
              <span>{project.source.codec.toUpperCase()}</span>
              <span>{project.source.aspectRatio}</span>
              <span className="ml-auto font-medium text-violet-300 transition group-hover:text-violet-200">
                Abrir proyecto →
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha desconocida";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
