import Link from "next/link";
import { ChannelConnections } from "@/components/ChannelConnections";
import { ChannelService } from "@/services/channels/ChannelService.mjs";
import type { ChannelRecord } from "@/types/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionsSearchParams = {
  oauth?: string | string[];
  platform?: string | string[];
  message?: string | string[];
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<ConnectionsSearchParams>;
}) {
  const params = await searchParams;
  const oauthNotice = buildOAuthNotice(params);
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

        {oauthNotice ? (
          <div
            className={`mt-6 rounded-2xl border p-4 text-sm leading-6 ${
              oauthNotice.kind === "success"
                ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-100/80"
                : "border-red-400/20 bg-red-400/[0.05] text-red-100/80"
            }`}
          >
            {oauthNotice.message}
          </div>
        ) : null}

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


function buildOAuthNotice(params: ConnectionsSearchParams) {
  const oauth = firstParam(params.oauth);
  if (!oauth) return null;

  const platform = firstParam(params.platform).toUpperCase();
  const platformLabel =
    platform === "YOUTUBE"
      ? "YouTube"
      : platform === "TIKTOK"
        ? "TikTok"
        : platform === "FACEBOOK"
          ? "Facebook"
          : "La cuenta";

  if (oauth === "connected") {
    return {
      kind: "success" as const,
      message: `${platformLabel} quedó conectado correctamente. Verifica abajo el canal autorizado.`,
    };
  }

  if (oauth === "page_selection_required") {
    return {
      kind: "success" as const,
      message: "La autorización terminó. Falta seleccionar la página de Facebook.",
    };
  }

  const detail = firstParam(params.message).slice(0, 300);
  return {
    kind: "error" as const,
    message: detail
      ? `No se pudo completar la conexión OAuth: ${detail}`
      : "No se pudo completar la conexión OAuth. Revisa la configuración del proveedor e inténtalo de nuevo.",
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}
