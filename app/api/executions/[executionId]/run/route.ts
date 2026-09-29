import { NextRequest, NextResponse } from "next/server";
import { OwnedContentWorkflowRunner } from "@/services/owned-content/OwnedContentWorkflowRunner.mjs";
import { MarketingWorkflowRunner } from "@/services/workflows/MarketingWorkflowRunner.mjs";
import { WorkflowService } from "@/services/workflows/WorkflowService.mjs";

type Context = { params: Promise<{ executionId: string }> };
type WorkflowStep = { type?: string };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: Context) {
  try {
    const { executionId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "RUN").trim().toUpperCase();
    const workflows = new WorkflowService();
    const execution = await workflows.getExecution(executionId);
    if (!execution) throw new Error("Workflow execution not found.");
    const workflow = await workflows.getWorkflow(execution.workflowId);
    if (!workflow) throw new Error("Workflow definition not found.");

    const isOwnedContent = workflow.steps?.some((step: WorkflowStep) =>
      String(step.type || "").startsWith("OWNED_"),
    );
    const runner = isOwnedContent
      ? new OwnedContentWorkflowRunner({ workflows })
      : new MarketingWorkflowRunner({ workflows });

    const result = action === "CONTINUE_AFTER_APPROVAL"
      ? await runner.continueAfterHumanApproval(executionId)
      : await runner.run(executionId, { maxSteps: body?.maxSteps });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
