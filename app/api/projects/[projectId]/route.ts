import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ProjectStore } from "@/services/ProjectStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projects = new ProjectStore();

export async function DELETE(
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
    const deleted = await projects.delete(projectId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Proyecto no encontrado." },
        { status: 404 },
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el proyecto.",
      },
      { status: 500 },
    );
  }
}
