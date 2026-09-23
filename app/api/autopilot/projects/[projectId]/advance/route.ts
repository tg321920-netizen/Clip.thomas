import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { AutopilotService } from "@/services/autopilot/AutopilotService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const autopilot = new AutopilotService();

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  if (!isProjectId(projectId)) {
    return NextResponse.json(
      { error: "Identificador de proyecto inválido." },
      { status: 400 },
    );
  }

  try {
    const result = await autopilot.advanceProject(projectId, {
      allowManual: true,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo avanzar el proyecto.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
