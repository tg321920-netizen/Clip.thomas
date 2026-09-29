import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = new WorkflowService();

type RouteContext = { params: Promise<{ workflowId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { workflowId } = await context.params;
  if (!isProjectId(workflowId)) {
    return NextResponse.json({ error: "workflowId inválido." }, { status: 400 });
  }

  const workflow = await workflows.getWorkflow(workflowId);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow no encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    { workflow },
    { headers: { "Cache-Control": "no-store" } },
  );
}
