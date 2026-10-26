import Link from "next/link";
import { redirect } from "next/navigation";
import { ownedContentRuntimeHref } from "@/lib/owned-content-runtime.mjs";
import { MediaTools } from "@/components/MediaTools";
import { RecentProjects } from "@/components/RecentProjects";
import { StreamCapturePanel } from "@/components/StreamCapturePanel";
import { ManualLiveCapture } from "@/components/ManualLiveCapture";
import { UploadPanel } from "@/components/UploadPanel";
import { MediaEnvironmentStatus } from "@/components/MediaEnvironmentStatus";
import { releasePolicy } from "@/lib/release-policy.mjs";
export const dynamic = 'force-dynamic';
export default function Home() {
  const runtimeHref = ownedContentRuntimeHref("/");
  if (runtimeHref) redirect(runtimeHref);
  const release=releasePolicy();
  return <main className="min-h-screen bg-[#07080b] text-zinc-100"><div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-5"><div><p className="text-sm font-semibold text-violet-300">CLIPFORGE STUDIO · {release.channel==='stable'?'VERSIÓN ESTABLE':'DESARROLLO'} · {release.version}</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Subí tu video, elegí un fragmento y descargá el clip.</h1></div><form action="/api/auth/owner/logout" method="post"><button type="submit" className="min-h-12 rounded-xl border border-white/15 px-4 py-3">Salir</button></form></header>
    <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300">Recortá podcasts y videos autorizados desde tu celular. Conservá el audio original y revisá el MP4 antes de descargarlo. También podés pedir sugerencias con análisis local.</p>
    <MediaTools defaultLiveSource={process.env.CLIPFORGE_DEFAULT_LIVE_URL || ''} experimental={release.experimental} /><RecentProjects />
    <details className="mt-6 rounded-2xl border border-white/15 p-4"><summary className="cursor-pointer py-3 text-base">Herramientas y ajustes avanzados</summary><div className="mt-4 grid gap-6">
      <MediaEnvironmentStatus />{release.experimental&&<><UploadPanel /><StreamCapturePanel /><ManualLiveCapture /></>}
      <nav aria-label="Ajustes avanzados" className="flex flex-wrap gap-4">{[["/marketing","Marketing"],["/approvals","Aprobaciones"],["/connections","Conexiones"],["/autopilot","Autopilot"]].map(([href,title]) => <Link key={href} href={href} className="min-h-12 rounded-xl border border-white/15 px-4 py-3">{title}</Link>)}</nav>
    </div></details><footer className="mt-8 border-t border-white/15 py-5 text-sm text-zinc-400">Publicación automática: OFF. En Render gratuito, los archivos pueden perderse al reemplazar la instancia: descarga tus resultados. El tiempo de entrega todavía debe medirse con material real.</footer>
  </div></main>;
}

