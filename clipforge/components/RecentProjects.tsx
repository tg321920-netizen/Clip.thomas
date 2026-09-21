"use client";

import { useEffect, useState } from "react";
import type { UploadedVideo } from "@/types/video";

type ProjectRecord = {
  id: string;
  createdAt: string;
  source: UploadedVideo;
};

export function RecentProjects() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("projects");
        return (await response.json()) as { projects?: ProjectRecord[] };
      })
      .then((payload) => {
        if (!active) return;
        setProjects(payload.projects ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

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
          <article
            key={project.id}
            className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
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
            <div className="mt-3 flex gap-3 text-xs text-zinc-500">
              <span>{formatDuration(project.source.durationSeconds)}</span>
              <span>{project.source.codec.toUpperCase()}</span>
              <span>{project.source.aspectRatio}</span>
            </div>
          </article>
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
