import Link from "next/link";
import ContentFactoryBoard from "@/components/ContentFactoryBoard";
import { BrandService } from "@/services/branding/BrandService.mjs";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ContentFactoryPage() {
  const factory = new ContentFactoryService();
  const brands = new BrandService();
  const [dashboard, brandRecords] = await Promise.all([
    factory.listDashboard(),
    brands.list(),
  ]);

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">Content Factory</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Fábrica multicanal</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Cada canal conserva su plataforma, marca, idioma, nicho, estrategia, edición, frecuencia y rendimiento usando los servicios existentes de ClipForge.</p>
            </div>
            <div className="flex gap-2">
              <Link href="/marketing" className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">Marketing</Link>
              <Link href="/connections" className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">Conexiones</Link>
            </div>
          </div>
        </header>

        <section className="mt-5">
          <ContentFactoryBoard
            initialData={dashboard}
            brands={brandRecords.map((brand: { id: string; name: string }) => ({ id: brand.id, name: brand.name }))}
          />
        </section>
      </div>
    </main>
  );
}
