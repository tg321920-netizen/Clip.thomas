import { Readable } from "node:stream";
import { isProjectId } from "@/lib/project-id.mjs";
import { loadProjectFile } from "@/lib/project-files.mjs";
import { createClipArchive } from "@/lib/clip-archive.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  if (!isProjectId(projectId)) return Response.json({ error: "Proyecto inválido." }, { status: 400 });
  const project = await loadProjectFile(projectId);
  if (!project) return Response.json({ error: "Proyecto no encontrado." }, { status: 404 });
  try {
    const archive = await createClipArchive(project);
    const abort = () => archive.destroy(new Error("Descarga cancelada."));
    request.signal.addEventListener("abort", abort, { once: true });
    archive.once("close", () => request.signal.removeEventListener("abort", abort));
    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="clipforge-${projectId}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "No hay clips terminados disponibles para descargar." }, { status: 409 });
  }
}
