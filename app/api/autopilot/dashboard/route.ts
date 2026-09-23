import { NextResponse } from "next/server";
import { DashboardService } from "@/services/dashboard/DashboardService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dashboard = new DashboardService();

export async function GET() {
  try {
    return NextResponse.json(await dashboard.getSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo cargar el panel de Autopilot.",
      },
      { status: 500 },
    );
  }
}
