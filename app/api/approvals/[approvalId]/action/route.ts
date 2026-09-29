import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ApprovalService } from "@/services/approvals/ApprovalService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approvals = new ApprovalService();
type RouteContext = { params: Promise<{ approvalId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { approvalId } = await context.params;
  if (!isProjectId(approvalId)) {
    return NextResponse.json({ error: "approvalId inválido." }, { status: 400 });
  }

  const body = await safeJson(request);
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  try {
    let approval;
    if (action === "approve") {
      approval = await approvals.approve(approvalId, {
        selectedVariantId: body.selectedVariantId,
        note: body.note,
      });
    } else if (action === "modify" || action === "request_changes") {
      approval = await approvals.requestChanges(approvalId, { note: body.note });
    } else if (action === "reject") {
      approval = await approvals.reject(approvalId, { note: body.note });
    } else if (action === "cancel") {
      approval = await approvals.cancel(approvalId, { note: body.note });
    } else {
      return NextResponse.json(
        { error: "Acción inválida. Usa approve, modify, reject o cancel." },
        { status: 400 },
      );
    }

    return NextResponse.json({ approval });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo resolver la aprobación.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
