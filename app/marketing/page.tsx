import type { ReactNode } from "react";
import Link from "next/link";
import { ApprovalService } from "@/services/approvals/ApprovalService.mjs";
import { BrandService } from "@/services/branding/BrandService.mjs";
import { ContentGenerationRepository } from "@/services/content-generation/ContentGenerationRepository.mjs";
import { MarketingPublishingHub } from "@/services/publishing/MarketingPublishingHub.mjs";
import { WorkflowRecipeService } from "@/services/workflows/WorkflowRecipeService.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

type ExecutionSummary = {
  id: string;
  status: string;
  currentStepId: string | null;
  retries?: number;
};

type ContentSummary = {
  status: string;
};

type PublishingSummary = {
  dryRun?: boolean;
  status: string;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MarketingDashboard() {
  const workflows = new WorkflowService();
  const approvals = new ApprovalService();
  const content = new ContentGenerationRepository();
  const brands = new BrandService();
  const publishing = new MarketingPublishingHub();
  const recipes = new WorkflowRecipeService();

  const [rawExecutions, pending, rawGenerations, brandRecords, rawSimulations] = await Promise.all([
    workflows.listExecutions(),
    approvals.list({ status: "PENDING" }),
    content.list(),
    brands.list(),
    publishing.list(),
  ]);

  const executions = rawExecutions as ExecutionSummary[];
  const generations = rawGenerations as ContentSummary[];
  const simulations = rawSimulations as PublishingSummary[];
  const active = executions.filter((item: ExecutionSummary) => !["completed", "cancelled", "failed"].includes(item.status));
  const errors = executions.filter((item: ExecutionSummary) => item.status === "failed");
  const completed = executions.filter((item: ExecutionSummary) => item.status === "completed");

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="border-b border-white/10 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">ClipForge Marketing</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Crear, aprobar, distribuir y aprender</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            Flujo móvil: fuente → entender → contenido → edición → aprobación → publicación → analíticas.
          </p>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Action href="/" title="Crear clip" text="Video, enlace o captura" />
          <Action href="/approvals" title="Necesita tu atención" text={`${pending.length} pendiente(s)`} />
          <Action href="/autopilot" title="Autopilot" text="Canales y rendimiento" />
          <Action href="/connections" title="Conexiones" text="Cuentas autorizadas" />
        </section>

        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="En ejecución" value={active.length} />
          <Stat label="Completadas" value={completed.length} />
          <Stat label="Errores" value={errors.length} />
          <Stat label="Marcas" value={brandRecords.length} />
        </section>

        <section className="mt-7 grid gap-4 lg:grid-cols-2">
          <Panel title="Automatizaciones">
            {active.length === 0 ? <Empty text="No hay automatizaciones activas." /> : active.slice(0, 8).map((item: ExecutionSummary) => (
              <div key={item.id} className="rounded-xl border border-white/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{item.currentStepId || "Finalizando"}</p>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] uppercase text-zinc-400">{item.status}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-600">{item.id.slice(0, 8)} · reintentos {item.retries || 0}</p>
              </div>
            ))}
          </Panel>

          <Panel title="Contenido">
            <div className="grid grid-cols-2 gap-3">
              <Mini label="Piezas" value={generations.length} />
              <Mini label="Aprobadas" value={generations.filter((item: ContentSummary) => item.status === "APPROVED").length} />
              <Mini label="Esperando" value={generations.filter((item: ContentSummary) => item.status === "WAITING_APPROVAL").length} />
              <Mini label="Rechazadas" value={generations.filter((item: ContentSummary) => item.status === "REJECTED").length} />
            </div>
          </Panel>

          <Panel title="Publishing Hub">
            <div className="grid grid-cols-2 gap-3">
              <Mini label="Simulaciones" value={simulations.filter((item: PublishingSummary) => item.dryRun).length} />
              <Mini label="Esperando aprobación" value={simulations.filter((item: PublishingSummary) => item.status === "WAITING_APPROVAL").length} />
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">Las automatizaciones nuevas trabajan en DRY RUN. La publicación real exige aprobación y conexión autorizada.</p>
          </Panel>

          <Panel title="Recetas">
            <div className="space-y-2">
              {recipes.listRecipes().map((recipe) => (
                <div key={recipe.key} className="rounded-xl border border-white/10 px-3 py-2.5">
                  <p className="text-sm font-medium text-zinc-200">{recipe.name}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">{recipe.description}</p>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Action({ href, title, text }: { href: string; title: string; text: string }) {
  return <Link href={href} className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.04] p-4 transition hover:bg-violet-400/[0.08]">
    <p className="text-sm font-semibold text-violet-200">{title}</p>
    <p className="mt-1 text-xs leading-5 text-zinc-500">{text}</p>
  </Link>;
}
function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/10 p-4"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-zinc-500">{label}</p></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-white/[0.03] p-3"><p className="text-lg font-semibold">{value}</p><p className="text-xs text-zinc-500">{label}</p></div>; }
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-white/[0.015] p-4 sm:p-5"><h2 className="mb-4 text-sm font-semibold text-zinc-200">{title}</h2><div className="space-y-3">{children}</div></section>; }
function Empty({ text }: { text: string }) { return <p className="text-sm text-zinc-600">{text}</p>; }
