import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = new WorkflowService();

type RouteContext = { params: Promise<{ executionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { executionId } = await context.params;
  if (!isProjectId(executionId)) {
    return NextResponse.json({ error: "executionId inválido." }, { status: 400 });
  }

  const execution = await workflows.getExecution(executionId);
  if (!execution) {
    return NextResponse.json({ error: "Ejecución no encontrada." }, { status: 404 });
  }

  return NextResponse.json(
    { execution },
    { headers: { "Cache-Control": "no-store" } },
  );
}
