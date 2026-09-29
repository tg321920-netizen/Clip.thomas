import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = new WorkflowService();

type RouteContext = { params: Promise<{ executionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { executionId } = await context.params;
  if (!isProjectId(executionId)) {
    return NextResponse.json({ error: "executionId inválido." }, { status: 400 });
  }

  const body = await safeJson(request);
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  try {
    let execution;

    switch (action) {
      case "start":
      case "start_step":
        execution = await workflows.startCurrentStep(executionId);
        break;
      case "complete":
      case "complete_step":
        execution = await workflows.completeCurrentStep(executionId, body.output ?? {});
        break;
      case "fail":
      case "fail_step":
        execution = await workflows.failCurrentStep(
          executionId,
          typeof body.error === "string" ? body.error : "Step failed.",
          { retryable: body.retryable !== false },
        );
        break;
      case "wait_information":
      case "request_information":
        execution = await workflows.waitForInformation(executionId, objectValue(body.details));
        break;
      case "resume":
      case "retry":
        execution = await workflows.resumeExecution(executionId);
        break;
      case "approve":
        execution = await workflows.approveExecution(executionId, objectValue(body.details));
        break;
      case "cancel":
      case "reject":
        execution = await workflows.cancelExecution(executionId, objectValue(body.details));
        break;
      default:
        return NextResponse.json(
          {
            error:
              "Acción inválida. Usa start, complete, fail, request_information, resume, approve, cancel o reject.",
          },
          { status: 400 },
        );
    }

    return NextResponse.json({ execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la ejecución.";
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
