import { NextResponse } from "next/server";
import { ContentFactoryService } from "@/services/content-factory/ContentFactoryService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factory = new ContentFactoryService();

export async function GET() {
  try {
    return NextResponse.json(await factory.listDashboard(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar Content Factory." },
      { status: 500 },
    );
  }
}
