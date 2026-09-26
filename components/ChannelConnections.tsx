"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChannelRecord } from "@/types/channel";

type FacebookPage = { id: string; name: string };

type Platform = ChannelRecord["platform"];

export function ChannelConnections({ channels }: { channels: ChannelRecord[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, FacebookPage[]>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [createMessage, setCreateMessage] = useState<string>("");
  const [platform, setPlatform] = useState<Platform>("TIKTOK");
  const [name, setName] = useState("");
  const [dailyLimit, setDailyLimit] = useState(3);

  async function createChannel() {
    const cleanName = name.trim();
    if (!cleanName) {
      setCreateMessage("Pon un nombre para identificar la cuenta o canal.");
      return;
    }

    setBusy("create");
    setCreateMessage("");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          name: cleanName,
          timezone,
          dailyLimit,
          status: "DISCONNECTED",
          publishingEnabled: false,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "No se pudo crear el canal.");
      setName("");
      setCreateMessage("Canal creado. Ahora pulsa Conectar para autorizar la cuenta real.");
      router.refresh();
    } catch (error) {
      setCreateMessage(
        error instanceof Error ? error.message : "No se pudo crear el canal.",
      );
    } finally {
      setBusy(null);
    }
  }

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

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Agregar canal</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Primero crea el canal dentro de ClipForge y después autoriza la cuenta con OAuth oficial.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_110px_auto]">
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as Platform)}
            disabled={busy === "create"}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-zinc-200 outline-none"
          >
            <option value="TIKTOK">TikTok</option>
            <option value="YOUTUBE">YouTube</option>
            <option value="FACEBOOK">Facebook</option>
          </select>

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. TikTok principal"
            maxLength={100}
            disabled={busy === "create"}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          />

          <input
            type="number"
            min={0}
            max={50}
            value={dailyLimit}
            onChange={(event) => setDailyLimit(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
            title="Publicaciones máximas por día"
            disabled={busy === "create"}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-zinc-200 outline-none"
          />

          <button
            type="button"
            onClick={() => void createChannel()}
            disabled={busy === "create"}
            className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
          >
            {busy === "create" ? "Creando…" : "+ Agregar"}
          </button>
        </div>

        <p className="mt-2 text-[11px] text-zinc-600">El número indica el límite máximo de publicaciones diarias.</p>
        {createMessage ? (
          <p className="mt-3 text-xs leading-5 text-zinc-300">{createMessage}</p>
        ) : null}
      </section>

      {channels.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-4 text-sm leading-6 text-zinc-500">
          No hay canales todavía. Usa “Agregar canal” arriba para crear el primero.
        </div>
      ) : (
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

                  {channel.platform === "FACEBOOK" && connected ? (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void loadFacebookPages(channel)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40"
                    >
                      Elegir página
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
      )}
    </div>
  );
}

function platformLabel(platform: ChannelRecord["platform"]) {
  if (platform === "YOUTUBE") return "YouTube";
  if (platform === "TIKTOK") return "TikTok";
  return "Facebook";
}
