import { NextRequest, NextResponse } from "next/server";
import { MarketingWorkflowRunner } from "@/services/workflows/MarketingWorkflowRunner.mjs";

type Context = { params: Promise<{ executionId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: Context) {
  try {
    const { executionId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "RUN").trim().toUpperCase();
    const runner = new MarketingWorkflowRunner();
    const result = action === "CONTINUE_AFTER_APPROVAL"
      ? await runner.continueAfterHumanApproval(executionId)
      : await runner.run(executionId, { maxSteps: body?.maxSteps });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
