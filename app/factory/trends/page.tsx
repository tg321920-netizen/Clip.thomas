import Link from "next/link";
import { redirect } from "next/navigation";
import TrendHunterBoard from "@/components/TrendHunterBoard";
import { ownedContentRuntimeHref } from "@/lib/owned-content-runtime.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";
import { TrendHunterService } from "@/services/owned-content/TrendHunterService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TrendHunterPage() {
  const runtimeHref = ownedContentRuntimeHref("/factory/trends");
  if (runtimeHref) redirect(runtimeHref);

  const factory = new ContentFactoryService();
  const trends = new TrendHunterService();
  const [dashboard, initialTrends] = await Promise.all([
    factory.listDashboard(),
    trends.list(),
  ]);

  const channels = dashboard.channels.map((view: {
    channel: { id: string; name: string; platform: string };
    profile: { lineKey: string | null; enabled: boolean };
  }) => ({
    id: view.channel.id,
    name: view.channel.name,
    platform: view.channel.platform,
    lineKey: view.profile.lineKey,
    enabled: view.profile.enabled,
  }));

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">Content Factory · Trend Hunter</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Oportunidades de contenido</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Recibe señales, las puntúa por canal y obliga a una selección humana antes de investigar. No conecta APIs pagas ni publica automáticamente.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/factory/new" className="rounded-xl bg-violet-500 px-3 py-2 text-sm font-semibold text-white">Nueva historia</Link>
              <Link href="/factory" className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">Volver a canales</Link>
            </div>
          </div>
        </header>
        <section className="mt-5">
          <TrendHunterBoard channels={channels} initialTrends={initialTrends} />
        </section>
      </div>
    </main>
  );
}
