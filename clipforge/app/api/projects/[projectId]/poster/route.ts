import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return NextResponse.json(
      { error: "Identificador de proyecto inválido." },
      { status: 400 },
    );
  }

  const posterPath = path.join(
    process.cwd(),
    "storage",
    "uploads",
    projectId,
    "poster.jpg",
  );

  try {
    const bytes = await readFile(posterPath);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;

    if (code === "ENOENT") {
      return NextResponse.json(
        { error: "Miniatura no encontrada." },
        { status: 404 },
      );
    }

    console.error("Poster read failed", error);
    return NextResponse.json(
      { error: "No se pudo cargar la miniatura." },
      { status: 500 },
    );
  }
}
