import Link from "next/link";
import { ApprovalInbox } from "@/components/ApprovalInbox";
import { ApprovalService } from "@/services/approvals/ApprovalService.mjs";
import { ContentGenerationRepository } from "@/services/content-generation/ContentGenerationRepository.mjs";
import { InternalNotificationService } from "@/services/notifications/InternalNotificationService.mjs";
import type { ApprovalRequest } from "@/types/approval";
import type { GeneratedContentVariant } from "@/types/content-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const approvalsService = new ApprovalService();
  const content = new ContentGenerationRepository();
  const notifications = new InternalNotificationService();

  const [pending, unread] = await Promise.all([
    approvalsService.list({ status: "PENDING" }),
    notifications.list({ unread: true }),
  ]);

  const enriched = await Promise.all(
    (pending as ApprovalRequest[]).map(async (approval: ApprovalRequest) => {
      if (approval.subjectType !== "CONTENT_GENERATION") return approval;
      const generation = await content.get(approval.subjectId);
      return {
        ...approval,
        variants: Array.isArray(generation?.variants)
          ? (generation.variants as GeneratedContentVariant[]).map((variant: GeneratedContentVariant) => ({
              id: variant.id,
              label: variant.label,
              angle: variant.angle,
              title: variant.title,
              hook: variant.hook,
              description: variant.description,
              cta: variant.cta,
            }))
          : [],
      };
    }),
  );

  return (
    <main className="min-h-screen bg-[#07080b] text-zinc-100">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400">
              ClipForge
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Necesita tu atención
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
              Revisá contenido y acciones sensibles antes de que ClipForge continúe.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/5"
          >
            Inicio
          </Link>
        </header>

        <div className="mt-6">
          <ApprovalInbox
            initialApprovals={enriched}
            unreadNotifications={unread.length}
          />
        </div>
      </div>
    </main>
  );
}
