"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("ClipForge unexpected application error", error);
  }, [error]);

  return (
    <html lang="es">
      <body className="min-h-screen bg-[#07080b] text-zinc-100">
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
          <section className="w-full rounded-3xl border border-red-400/20 bg-red-400/[0.07] p-6 shadow-2xl shadow-black/30">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300">
              ClipForge Multi
            </p>
            <h1 className="mt-3 text-2xl font-semibold">
              Ocurrió un error inesperado
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              El proyecto no fue reemplazado ni se inventó un resultado. Podés
              reintentar la operación o volver al inicio.
            </p>

            {error.digest && (
              <p className="mt-3 break-all text-xs text-zinc-600">
                Referencia: {error.digest}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => reset()}
                className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/10"
              >
                Volver al inicio
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
