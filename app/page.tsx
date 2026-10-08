import Link from "next/link";
import { redirect } from "next/navigation";
import { ownedContentRuntimeHref } from "@/lib/owned-content-runtime.mjs";
import { MediaTools } from "@/components/MediaTools";
import { RecentProjects } from "@/components/RecentProjects";
import { StreamCapturePanel } from "@/components/StreamCapturePanel";
import { ManualLiveCapture } from "@/components/ManualLiveCapture";
import { UploadPanel } from "@/components/UploadPanel";
import { MediaEnvironmentStatus } from "@/components/MediaEnvironmentStatus";
export default function Home() {
  const runtimeHref = ownedContentRuntimeHref("/");
  if (runtimeHref) redirect(runtimeHref);
  return <main className="min-h-screen bg-[#07080b] text-zinc-100"><div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-5"><div><p className="text-sm font-semibold text-violet-300">ClipForge Multi</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Crea y descarga tus videos.</h1></div><form action="/api/auth/owner/logout" method="post"><button type="submit" className="min-h-12 rounded-xl border border-white/15 px-4 py-3">Salir</button></form></header>
    <MediaTools /><RecentProjects />
    <details className="mt-6 rounded-2xl border border-white/15 p-4"><summary className="cursor-pointer py-3 text-base">Herramientas y ajustes avanzados</summary><div className="mt-4 grid gap-6">
      <MediaEnvironmentStatus /><UploadPanel /><StreamCapturePanel /><ManualLiveCapture />
      <nav aria-label="Ajustes avanzados" className="flex flex-wrap gap-4">{[["/marketing","Marketing"],["/approvals","Aprobaciones"],["/connections","Conexiones"],["/autopilot","Autopilot"]].map(([href,title]) => <Link key={href} href={href} className="min-h-12 rounded-xl border border-white/15 px-4 py-3">{title}</Link>)}</nav>
    </div></details><footer className="mt-8 border-t border-white/15 py-5 text-sm text-zinc-400">Publicación automática: OFF. El procesamiento continúa en el servidor después de guardar el trabajo.</footer>
  </div></main>;
}
