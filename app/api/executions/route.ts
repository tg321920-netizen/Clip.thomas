import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { EXECUTION_STATUSES, WorkflowService } from "@/services/workflows/WorkflowService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = new WorkflowService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId");
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status")?.toLowerCase() || null;

  for (const [label, value] of [
    ["workflowId", workflowId],
    ["projectId", projectId],
  ] as const) {
    if (value && !isProjectId(value)) {
      return NextResponse.json({ error: `${label} inválido.` }, { status: 400 });
    }
  }

  if (status && !EXECUTION_STATUSES.has(status)) {
    return NextResponse.json({ error: "Estado de ejecución inválido." }, { status: 400 });
  }

  const executions = await workflows.listExecutions({
    ...(workflowId ? { workflowId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
  });

  return NextResponse.json(
    { executions },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  const workflowId = typeof body.workflowId === "string" ? body.workflowId.trim() : "";

  if (!isProjectId(workflowId)) {
    return NextResponse.json({ error: "workflowId inválido." }, { status: 400 });
  }

  try {
    const result = await workflows.createExecution(workflowId, {
      projectId: body.projectId,
      idempotencyKey: body.idempotencyKey,
      input: body.input,
    });

    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return workflowError(error);
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

function workflowError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo crear la ejecución.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
