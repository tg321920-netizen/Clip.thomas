import Link from "next/link";
import { redirect } from "next/navigation";
import OwnedStoryStarter from "@/components/OwnedStoryStarter";
import { ownedContentRuntimeHref } from "@/lib/owned-content-runtime.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewOwnedStoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const runtimeHref = ownedContentRuntimeHref("/factory/new", params);
  if (runtimeHref) redirect(runtimeHref);

  const dashboard = await new ContentFactoryService().listDashboard();
  const channels = dashboard.channels.map((view: {
    channel: { id: string; name: string; platform: string };
    profile: { lineKey: string | null; language: string; defaultFormat: string; enabled: boolean };
  }) => ({
    id: view.channel.id,
    name: view.channel.name,
    platform: view.channel.platform,
    lineKey: view.profile.lineKey,
    language: view.profile.language,
    defaultFormat: view.profile.defaultFormat,
    enabled: view.profile.enabled,
  }));

  const initial = {
    channelId: single(params.channelId),
    topic: single(params.topic),
    category: single(params.category) || "GENERAL",
    trendId: single(params.trendId),
    trendSignal: {
      sourceCount: numberParam(params.sourceCount),
      growthScore: numberParam(params.growthScore),
      saturationScore: numberParam(params.saturationScore),
      originalityPotential: numberParam(params.originalityPotential),
    },
  };

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">Content Factory</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Nueva historia</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Inicia una investigación multifuente para uno de tus canales propios. El flujo se detiene antes de cualquier publicación real.</p>
            </div>
            <div className="flex gap-2">
              <Link href="/factory/trends" className="rounded-xl border border-violet-400/20 px-3 py-2 text-sm text-violet-300">Trend Hunter</Link>
              <Link href="/factory" className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">Volver a canales</Link>
            </div>
          </div>
        </header>
        <section className="mt-5">
          <OwnedStoryStarter channels={channels} initial={initial} />
        </section>
      </div>
    </main>
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function numberParam(value: string | string[] | undefined) {
  const number = Number(single(value));
  return Number.isFinite(number) ? number : undefined;
}
