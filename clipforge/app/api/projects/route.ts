import { NextResponse } from "next/server";
import { ProjectStore } from "@/services/ProjectStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = new ProjectStore();

export async function GET() {
  try {
    const projects = await store.list(20);
    return NextResponse.json(
      { projects },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Project listing failed", error);
    return NextResponse.json(
      { error: "No se pudieron cargar los proyectos." },
      { status: 500 },
    );
  }
}
