"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChannelRecord } from "@/types/channel";

type FacebookPage = { id: string; name: string };

export function ChannelConnections({ channels }: { channels: ChannelRecord[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, FacebookPage[]>>({});
  const [message, setMessage] = useState<Record<string, string>>({});

  async function disconnect(channel: ChannelRecord) {
    setBusy(channel.id);
    setMessage((current) => ({ ...current, [channel.id]: "" }));
    try {
      const response = await fetch(
        `/api/oauth/${channel.platform.toLowerCase()}/disconnect?channelId=${encodeURIComponent(channel.id)}`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "No se pudo desconectar.");
      setPages((current) => ({ ...current, [channel.id]: [] }));
      setMessage((current) => ({ ...current, [channel.id]: "Cuenta desconectada." }));
      router.refresh();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [channel.id]: error instanceof Error ? error.message : "No se pudo desconectar.",
      }));
    } finally {
      setBusy(null);
    }
  }

  async function loadFacebookPages(channel: ChannelRecord) {
    setBusy(channel.id);
    setMessage((current) => ({ ...current, [channel.id]: "" }));
    try {
      const response = await fetch(
        `/api/oauth/facebook/pages?channelId=${encodeURIComponent(channel.id)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "No se pudieron cargar las páginas.");
      const list = Array.isArray(body?.pages) ? body.pages : [];
      setPages((current) => ({ ...current, [channel.id]: list }));
      if (list.length === 0) {
        setMessage((current) => ({
          ...current,
          [channel.id]: "La cuenta autorizada no devolvió páginas administrables.",
        }));
      }
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [channel.id]: error instanceof Error ? error.message : "No se pudieron cargar las páginas.",
      }));
    } finally {
      setBusy(null);
    }
  }

  async function selectFacebookPage(channel: ChannelRecord, pageId: string) {
    setBusy(channel.id);
    try {
      const response = await fetch(
        `/api/oauth/facebook/pages?channelId=${encodeURIComponent(channel.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "No se pudo seleccionar la página.");
      setPages((current) => ({ ...current, [channel.id]: [] }));
      setMessage((current) => ({
        ...current,
        [channel.id]: `Página conectada: ${body?.page?.name || pageId}`,
      }));
      router.refresh();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [channel.id]: error instanceof Error ? error.message : "No se pudo seleccionar la página.",
      }));
    } finally {
      setBusy(null);
    }
  }

  if (channels.length === 0) {
    return <p className="text-sm leading-6 text-zinc-500">Todavía no hay canales configurados.</p>;
  }

  return (
    <div className="space-y-3">
      {channels.map((channel) => {
        const connected = channel.status === "CONNECTED";
        const channelPages = pages[channel.id] || [];
        const working = busy === channel.id;

        return (
          <div key={channel.id} className="rounded-xl border border-white/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{channel.name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {channel.platform}
                  {channel.externalAccountId ? ` · ${channel.externalAccountId}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  connected
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-white/5 text-zinc-400"
                }`}
              >
                {channel.status}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {!connected ? (
                <a
                  href={`/api/oauth/${channel.platform.toLowerCase()}/start?channelId=${encodeURIComponent(channel.id)}`}
                  className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-400"
                >
                  Conectar {platformLabel(channel.platform)}
                </a>
              ) : (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void disconnect(channel)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40"
                >
                  Desconectar
                </button>
              )}

              {channel.platform === "FACEBOOK" && !connected ? (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void loadFacebookPages(channel)}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40"
                >
                  Elegir página autorizada
                </button>
              ) : null}
            </div>

            {channelPages.length > 0 ? (
              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs text-zinc-500">Selecciona la página que publicará Reels:</p>
                {channelPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    disabled={working}
                    onClick={() => void selectFacebookPage(channel, page.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                  >
                    <span>{page.name}</span>
                    <span className="text-zinc-600">{page.id}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {message[channel.id] ? (
              <p className="mt-3 text-xs leading-5 text-zinc-400">{message[channel.id]}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function platformLabel(platform: ChannelRecord["platform"]) {
  if (platform === "YOUTUBE") return "YouTube";
  if (platform === "TIKTOK") return "TikTok";
  return "Facebook";
}
