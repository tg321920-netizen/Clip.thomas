import { NextResponse } from "next/server";
import { AutopilotService } from "@/services/autopilot/AutopilotService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const autopilot = new AutopilotService();

export async function GET() {
  return NextResponse.json(
    { config: await autopilot.getConfig() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const body = await safeJson(request);

  try {
    const config = await autopilot.updateConfig(body);
    return NextResponse.json({ config });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo actualizar Autopilot.";
    return NextResponse.json({ error: message }, { status: 422 });
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
