import Link from "next/link";
import { ManualLiveCapture } from "@/components/ManualLiveCapture";
import { MediaEnvironmentStatus } from "@/components/MediaEnvironmentStatus";
import { RecentProjects } from "@/components/RecentProjects";
import { StreamCapturePanel } from "@/components/StreamCapturePanel";
import { UploadPanel } from "@/components/UploadPanel";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
              ClipForge Multi
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Convierte videos largos en clips listos para publicar.
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/connections"
              className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/5"
            >
              CONEXIONES
            </Link>
            <Link
              href="/autopilot"
              className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/5"
            >
              AUTOPILOT
            </Link>
            <form action="/api/auth/owner/logout" method="post">
              <button
                type="submit"
                className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
              >
                SALIR
              </button>
            </form>
            <a
              href="#nuevo-proyecto"
              className="shrink-0 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
            >
              + NUEVO PROYECTO
            </a>
          </div>
        </header>

        <section
          id="nuevo-proyecto"
          className="grid scroll-mt-6 flex-1 gap-8 py-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center"
        >
          <div>
            <div className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
              Upload + FFprobe + FFmpeg real
            </div>

            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
              Sube un MP4, MOV o WebM. El archivo se guarda por streaming,
              FFprobe lee los metadatos y FFmpeg genera una miniatura real.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                ["01", "Subir", "Sin cargar el video completo en RAM"],
                ["02", "Analizar", "Metadatos reales con FFprobe"],
                ["03", "Previsualizar", "Video real con seek por HTTP Range"],
              ].map(([number, title, description]) => (
                <div
                  key={number}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                >
                  <span className="text-xs font-medium text-violet-400">{number}</span>
                  <h2 className="mt-3 font-medium">{title}</h2>
                  <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
                </div>
              ))}
            </div>

            <MediaEnvironmentStatus />
          </div>

          <UploadPanel />
        </section>

        <div className="space-y-6 pb-10">
          <StreamCapturePanel />
          <ManualLiveCapture />
        </div>

        <RecentProjects />

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          Sin análisis falso, sin progreso simulado y sin clips inventados.
        </footer>
      </div>
    </main>
  );
}
