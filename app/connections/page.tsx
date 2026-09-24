import Link from "next/link";
import { ChannelConnections } from "@/components/ChannelConnections";
import { ChannelService } from "@/services/channels/ChannelService.mjs";
import type { ChannelRecord } from "@/types/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const service = new ChannelService();
  const channels = (await service.listChannels()) as ChannelRecord[];

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
              ClipForge · conexiones
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Conecta los canales con OAuth oficial
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
              Los secretos y tokens se procesan del lado servidor y se guardan cifrados.
              ClipForge no marca un canal como conectado hasta completar el flujo real.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/autopilot"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300"
            >
              Autopilot
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300"
            >
              Inicio
            </Link>
          </div>
        </header>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <ChannelConnections channels={channels} />
        </section>

        <div className="mt-5 rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-4 text-sm leading-6 text-amber-100/70">
          Si falta la configuración server-side de una plataforma, el botón de conexión
          falla cerrado y muestra el motivo. TikTok/Google/Meta deben tener sus redirect
          URIs y permisos aprobados antes de una conexión real.
        </div>
      </div>
    </main>
  );
}
