import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ProjectStore, type ProjectRecord } from "@/services/ProjectStore";
import { loadProjectFile, updateProjectFile } from '@/lib/project-files.mjs';
import { readBoundedJson } from '@/lib/bounded-json.mjs';
import { normalizeGlossary } from '@/services/subtitles/TranslationQualityService.mjs';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projects = new ProjectStore();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  if (!isProjectId(projectId)) return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  const project = await loadProjectFile(projectId);
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 });
  return NextResponse.json({ translationSettings: project.translationSettings || { glossary: [] } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  if (!isProjectId(projectId)) return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  try {
    const body = await readBoundedJson(request, 20000);
    if (!body || !Array.isArray(body.glossary)) throw new Error('Indica el glosario del proyecto.');
    const glossary = normalizeGlossary(body.glossary);
    const settings = await updateProjectFile(projectId, (project: ProjectRecord) => {
      project.translationSettings = { ...project.translationSettings, glossary, updatedAt: new Date().toISOString() };
      return project.translationSettings;
    });
    return NextResponse.json({ translationSettings: settings }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar el glosario.';
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 422 });
  }
}

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
      { status: error && typeof error === 'object' && 'code' in error && error.code === 'PROJECT_IN_USE' ? 409 : 500 },
    );
  }
}
