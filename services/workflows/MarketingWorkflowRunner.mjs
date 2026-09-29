import { ApprovalService } from "../approvals/ApprovalService.mjs";
import { BrandService } from "../branding/BrandService.mjs";
import { ContentGenerationService } from "../content-generation/ContentGenerationService.mjs";
import { ExtractionService } from "../extraction/ExtractionService.mjs";
import { MarketingMemoryService } from "../marketing-memory/MarketingMemoryService.mjs";
import { MarketingBrainService } from "../marketing-brain/MarketingBrainService.mjs";
import { MarketingEditService } from "../media-processing/MarketingEditService.mjs";
import { MarketingPublishingHub } from "../publishing/MarketingPublishingHub.mjs";
import { SourceService } from "../sources/SourceService.mjs";
import { WorkflowService } from "./WorkflowService.mjs";

const TERMINAL = new Set(["completed", "cancelled", "failed"]);
const PAUSED = new Set(["waiting_approval", "waiting_information"]);

export class MarketingWorkflowRunner {
  constructor(options = {}) {
    this.workflows = options.workflows || new WorkflowService();
    this.sources = options.sources || new SourceService();
    this.extraction = options.extraction || new ExtractionService();
    this.brain = options.brain || new MarketingBrainService();
    this.content = options.content || new ContentGenerationService();
    this.approvals = options.approvals || new ApprovalService();
    this.edits = options.edits || new MarketingEditService();
    this.brands = options.brands || new BrandService();
    this.publishing = options.publishing || new MarketingPublishingHub();
    this.memory = options.memory || new MarketingMemoryService();
  }

  async run(executionId, options = {}) {
    const maxSteps = boundedInteger(options.maxSteps, 1, 100, 25);
    let processed = 0;

    while (processed < maxSteps) {
      let execution = await this.workflows.getExecution(executionId);
      if (!execution) throw new Error("Workflow execution not found.");
      if (TERMINAL.has(execution.status) || PAUSED.has(execution.status)) {
        return { execution, processedSteps: processed };
      }

      const workflow = await this.workflows.getWorkflow(execution.workflowId);
      if (!workflow) throw new Error("Workflow definition not found.");
      const step = currentStep(execution);
      if (!step) return { execution, processedSteps: processed };

      if (step.type === "APPROVAL") {
        const generationId = findResultValue(execution, workflow, ["CONTENT"], "generationId");
        if (!generationId) {
          execution = await this.workflows.waitForInformation(execution.id, {
            reason: "No content generation exists to approve.",
          });
          return { execution, processedSteps: processed };
        }

        const request = await this.approvals.requestForContentGeneration(generationId, {
          title: "Contenido listo para aprobar",
          message: "Revisá las variantes, elegí una y aprobala para que el workflow continúe.",
          details: { executionId: execution.id, workflowId: workflow.id },
        });
        execution = await this.workflows.startCurrentStep(execution.id);
        return { execution, approval: request.approval, processedSteps: processed };
      }

      try {
        execution = await this.workflows.startCurrentStep(execution.id);
        const output = await this.#executeStep(step, execution, workflow);
        execution = await this.workflows.completeCurrentStep(execution.id, output);
        processed += 1;
      } catch (error) {
        const latest = await this.workflows.getExecution(executionId);
        if (latest && latest.status === "processing") {
          execution = await this.workflows.failCurrentStep(executionId, error, { retryable: true });
        } else {
          execution = latest || execution;
        }
        return { execution, error: error instanceof Error ? error.message : String(error), processedSteps: processed };
      }
    }

    return { execution: await this.workflows.getExecution(executionId), processedSteps: processed, limitReached: true };
  }

  async continueAfterHumanApproval(executionId) {
    const execution = await this.workflows.getExecution(executionId);
    if (!execution) throw new Error("Workflow execution not found.");
    if (execution.status !== "waiting_approval") {
      throw new Error("Execution is not waiting for approval.");
    }
    const workflow = await this.workflows.getWorkflow(execution.workflowId);
    if (!workflow) throw new Error("Workflow definition not found.");
    const generationId = findResultValue(execution, workflow, ["CONTENT"], "generationId");
    if (!generationId) throw new Error("No content generation is associated with this approval step.");
    const approvals = await this.approvals.list({ subjectType: "CONTENT_GENERATION", subjectId: generationId });
    const approved = approvals.find((item) => item.status === "APPROVED");
    if (!approved) throw new Error("The content generation has not been approved yet.");
    await this.workflows.approveExecution(executionId, {
      approvalId: approved.id,
      selectedVariantId: approved.selectedVariantId,
    });
    return this.run(executionId);
  }

  async #executeStep(step, execution, workflow) {
    if (step.type === "SOURCE") {
      const input = { ...(execution.input?.source || {}), ...(step.config || {}) };
      if (!input.type && execution.projectId) {
        input.type = "CLIPFORGE_PROJECT";
        input.projectId = execution.projectId;
      }
      const source = await this.sources.create(input);
      return { sourceId: source.id, source };
    }

    if (step.type === "EXTRACT") {
      const sourceId = findResultValue(execution, workflow, ["SOURCE"], "sourceId") || execution.input?.sourceId;
      if (!sourceId) throw new Error("EXTRACT requires a sourceId.");
      const extraction = await this.extraction.extract(sourceId);
      return { extractionId: extraction.id, extraction };
    }

    if (step.type === "UNDERSTAND") {
      const extractionId = findResultValue(execution, workflow, ["EXTRACT"], "extractionId");
      if (!extractionId) throw new Error("UNDERSTAND requires an extraction.");
      const plan = await this.brain.createPlan({
        extractionIds: [extractionId],
        projectId: execution.projectId || undefined,
        ...(execution.input?.brief || {}),
        ...(step.config || {}),
      });
      return { planId: plan.id, plan };
    }

    if (step.type === "IDEA") {
      const planId = findResultValue(execution, workflow, ["UNDERSTAND"], "planId");
      if (!planId) throw new Error("IDEA requires a Marketing Brain plan.");
      const plan = await this.brain.get(planId);
      if (!plan) throw new Error("Marketing plan not found.");
      return {
        planId,
        idea: {
          objective: plan.objective,
          audience: plan.audience,
          concept: plan.concept,
          message: plan.message,
          cta: plan.cta,
          channels: plan.channels,
          format: plan.format,
        },
      };
    }

    if (step.type === "CONTENT") {
      const planId = findResultValue(execution, workflow, ["IDEA", "UNDERSTAND"], "planId");
      if (!planId) throw new Error("CONTENT requires a marketing plan.");
      const generation = await this.content.generate({
        planId,
        variantCount: step.config?.variantCount || execution.input?.variantCount || 3,
      });
      return { generationId: generation.id, generation };
    }

    if (step.type === "EDIT") {
      const generationId = findResultValue(execution, workflow, ["CONTENT"], "generationId");
      if (!generationId) throw new Error("EDIT requires approved generated content.");
      const template = execution.input?.editTemplate || {};
      const edit = await this.edits.prepare({
        generationId,
        brandId: execution.input?.brandId || step.config?.brandId,
        quality: step.config?.quality || template.quality,
        framingMode: step.config?.framingMode || template.framingMode,
        subtitleStyle: step.config?.subtitleStyle || template.subtitleStyle,
      });
      return { editId: edit.id, edit };
    }

    if (step.type === "BRAND") {
      const brandId = execution.input?.brandId || step.config?.brandId || null;
      if (!brandId) return { brandId: null, applied: false };
      const brand = await this.brands.get(brandId);
      if (!brand) throw new Error("Configured brand not found.");
      return { brandId: brand.id, brand, applied: true };
    }

    if (step.type === "PUBLISH") {
      const generationId = findResultValue(execution, workflow, ["CONTENT"], "generationId");
      if (!generationId) throw new Error("PUBLISH requires generated content.");
      const result = await this.publishing.simulate({
        generationId,
        platform: step.config?.platform || execution.input?.platform,
        channelId: step.config?.channelId || execution.input?.channelId,
        scheduledAt: step.config?.scheduledAt || execution.input?.scheduledAt,
      });
      return { publicationSimulationId: result.simulation.id, simulation: result.simulation, dryRun: true };
    }

    if (step.type === "ANALYTICS") {
      const generationId = findResultValue(execution, workflow, ["CONTENT"], "generationId");
      const memory = generationId ? await this.memory.captureGeneration(generationId) : null;
      const summary = await this.memory.summarize({ ...(execution.projectId ? { projectId: execution.projectId } : {}) });
      return { memoryRecordId: memory?.record?.id || null, memorySummary: summary };
    }

    throw new Error(`No marketing workflow handler is registered for step type ${step.type}.`);
  }
}

function currentStep(execution) {
  return Number.isInteger(execution.currentStepIndex) ? execution.steps?.[execution.currentStepIndex] || null : null;
}

function findResultValue(execution, workflow, types, key) {
  const wanted = new Set(types);
  for (let index = workflow.steps.length - 1; index >= 0; index -= 1) {
    const step = workflow.steps[index];
    if (!wanted.has(step.type)) continue;
    const value = execution.results?.[step.id]?.[key];
    if (value) return value;
  }
  return null;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
