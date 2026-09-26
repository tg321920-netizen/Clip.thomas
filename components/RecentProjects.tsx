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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

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

  async function deleteProject(project: ProjectRecord) {
    const confirmed = window.confirm(
      `¿Eliminar ${project.source.originalName}? Se borrarán el video, transcripción, clips renderizados y archivos generados de este proyecto.`,
    );
    if (!confirmed) return;

    setDeletingId(project.id);
    setDeleteError("");

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error || "No se pudo eliminar el proyecto.");
      }

      setProjects((current) => current.filter((item) => item.id !== project.id));
      window.dispatchEvent(
        new CustomEvent("clipforge:project-deleted", {
          detail: { projectId: project.id },
        }),
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "No se pudo eliminar el proyecto.",
      );
    } finally {
      setDeletingId(null);
    }
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

      {deleteError ? (
        <p className="mb-3 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {deleteError}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {projects.slice(0, 6).map((project) => {
          const deleting = deletingId === project.id;

          return (
            <article
              key={project.id}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-violet-400/30"
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
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openProject(project)}
                  disabled={deleting}
                  className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
                >
                  Abrir proyecto
                </button>
                <button
                  type="button"
                  onClick={() => void deleteProject(project)}
                  disabled={deleting}
                  className="rounded-lg border border-red-400/25 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
                >
                  {deleting ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </article>
          );
        })}
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
