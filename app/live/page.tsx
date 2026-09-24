import { LiveCaptureWorkspace } from "@/components/LiveCaptureWorkspace";

export const dynamic = "force-dynamic";

export default function LiveCapturePage() {
  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
              ClipForge Multi
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Captura manual de LIVE
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Marca el inicio y el final de un momento en una pestaña o ventana compartida. Al terminar, ClipForge lo convierte en un proyecto y reutiliza Whisper, Auto Edit, subtítulos, Auto Focus y render 9:16.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/autopilot"
              className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
            >
              Autopilot
            </a>
            <a
              href="/"
              className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
            >
              Proyectos
            </a>
          </div>
        </header>

        <LiveCaptureWorkspace />
      </div>
    </main>
  );
}
