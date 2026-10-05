import { NextResponse } from "next/server";
import { AgentRuntimeService } from "@/services/agent/AgentRuntimeService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agent = new AgentRuntimeService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.getAll("status").filter(Boolean);

  try {
    const executions = await agent.listExecutions(
      status.length > 0 ? { status } : {},
    );
    return NextResponse.json(
      {
        enabled: agent.isEnabled(),
        mode: agent.defaultAutonomyMode(),
        providerConfigured: agent.provider?.isConfigured?.() === true,
        executions: executions.slice(0, 50),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return agentError(error);
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  if (!objective) {
    return NextResponse.json({ error: "objective es obligatorio." }, { status: 400 });
  }

  try {
    const execution = await agent.createTask({
      objective,
      trigger: "MANUAL",
      autonomyMode: body.autonomyMode,
      projectId: body.projectId,
      channelId: body.channelId,
      context:
        body.context && typeof body.context === "object" && !Array.isArray(body.context)
          ? body.context
          : {},
    });
    const result =
      body.runNow === false ? execution : await agent.runExecution(execution.id);
    return NextResponse.json({ execution: result }, { status: 201 });
  } catch (error) {
    return agentError(error);
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

function agentError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "No se pudo procesar el agente.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
