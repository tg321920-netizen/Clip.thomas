import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { AgentRuntimeService } from "@/services/agent/AgentRuntimeService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agent = new AgentRuntimeService();
type RouteContext = { params: Promise<{ executionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { executionId } = await context.params;
  if (!isProjectId(executionId)) {
    return NextResponse.json({ error: "executionId inválido." }, { status: 400 });
  }

  const body = await safeJson(request);
  const action =
    typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  try {
    let execution;
    if (action === "approve") {
      execution = await agent.approveExecution(executionId);
    } else if (action === "information") {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note) {
        return NextResponse.json(
          { error: "Escribe la información que necesita el agente." },
          { status: 400 },
        );
      }
      execution = await agent.provideInformation(executionId, {
        ownerNote: note.slice(0, 4000),
      });
    } else if (action === "cancel") {
      execution = await agent.cancelExecution(
        executionId,
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 1000)
          : "Cancelled by owner.",
      );
    } else if (action === "run") {
      execution = await agent.runExecution(executionId);
    } else {
      return NextResponse.json(
        { error: "Acción inválida. Usa approve, information, cancel o run." },
        { status: 400 },
      );
    }

    return NextResponse.json({ execution });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo actualizar el agente.";
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
