import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ApprovalService } from "@/services/approvals/ApprovalService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approvals = new ApprovalService();
type RouteContext = { params: Promise<{ approvalId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { approvalId } = await context.params;
  if (!isProjectId(approvalId)) {
    return NextResponse.json({ error: "approvalId inválido." }, { status: 400 });
  }

  const approval = await approvals.get(approvalId);
  if (!approval) {
    return NextResponse.json({ error: "Aprobación no encontrada." }, { status: 404 });
  }

  return NextResponse.json(
    { approval },
    { headers: { "Cache-Control": "no-store" } },
  );
}
