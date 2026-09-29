import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workflows = new WorkflowService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const enabledParam = url.searchParams.get("enabled");

  if (projectId && !isProjectId(projectId)) {
    return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  }

  const enabled =
    enabledParam === null ? undefined : enabledParam === "true" ? true : enabledParam === "false" ? false : null;
  if (enabledParam !== null && enabled === null) {
    return NextResponse.json({ error: "enabled debe ser true o false." }, { status: 400 });
  }

  const records = await workflows.listWorkflows({
    ...(projectId ? { projectId } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  });

  return NextResponse.json(
    { workflows: records },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = await safeJson(request);

  try {
    const workflow = await workflows.createWorkflow({
      name: body.name,
      description: body.description,
      projectId: body.projectId,
      enabled: body.enabled,
      steps: body.steps,
    });
    return NextResponse.json({ workflow }, { status: 201 });
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
  const message = error instanceof Error ? error.message : "No se pudo crear el workflow.";
  return NextResponse.json({ error: message }, { status: 422 });
}
