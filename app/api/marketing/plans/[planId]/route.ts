import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { MarketingBrainService } from "@/services/marketing-brain/MarketingBrainService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const marketingBrain = new MarketingBrainService();
type RouteContext = { params: Promise<{ planId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { planId } = await context.params;
  if (!isProjectId(planId)) {
    return NextResponse.json({ error: "planId inválido." }, { status: 400 });
  }

  const plan = await marketingBrain.get(planId);
  if (!plan) {
    return NextResponse.json({ error: "Plan de marketing no encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    { plan },
    { headers: { "Cache-Control": "no-store" } },
  );
}
