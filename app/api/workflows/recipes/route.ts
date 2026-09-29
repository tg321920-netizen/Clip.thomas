import { NextResponse } from "next/server";
import { WorkflowRecipeService } from "@/services/workflows/WorkflowRecipeService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const service = new WorkflowRecipeService();
  return NextResponse.json({ recipes: service.listRecipes() });
}

export async function POST() {
  try {
    const workflows = await new WorkflowRecipeService().ensureRecipes();
    return NextResponse.json({ workflows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
