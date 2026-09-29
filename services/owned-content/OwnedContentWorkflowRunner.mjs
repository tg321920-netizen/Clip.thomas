import { ApprovalService } from "../approvals/ApprovalService.mjs";
import { BrandService } from "../branding/BrandService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { SourceService } from "../sources/SourceService.mjs";
import { WorkflowService } from "../workflows/WorkflowService.mjs";
import { AudioEngine } from "./AudioEngine.mjs";
import { CoherenceGate } from "./CoherenceGate.mjs";
import { OriginalNewsScriptService } from "./OriginalNewsScriptService.mjs";
import { OwnedContentPerformanceService } from "./OwnedContentPerformanceService.mjs";
import { OwnedContentRenderService } from "./OwnedContentRenderService.mjs";
import { ResearchEngine } from "./ResearchEngine.mjs";
import { TrendHunterService } from "./TrendHunterService.mjs";
import { VisualAssemblyService } from "./VisualAssemblyService.mjs";

const TERMINAL = new Set(["completed", "cancelled", "failed"]);
const PAUSED = new Set(["waiting_approval", "waiting_information"]);

export class OwnedContentWorkflowRunner {
  constructor(options = {}) {
    this.workflows = options.workflows || new WorkflowService();
    this.approvals = options.approvals || new ApprovalService();
    this.brands = options.brands || new BrandService();
    this.publications = options.publications || new PublicationService();
    this.sources = options.sources || new SourceService();
    this.trends = options.trends || new TrendHunterService();
    this.research = options.research || new ResearchEngine({ sources: this.sources });
    this.scripts = options.scripts || new OriginalNewsScriptService();
    this.audio = options.audio || new AudioEngine();
    this.visuals = options.visuals || new VisualAssemblyService();
    this.renderer = options.renderer || new OwnedContentRenderService();
    this.gate = options.gate || new CoherenceGate();
    this.performance = options.performance || new OwnedContentPerformanceService({ publications: this.publications });
  }

  async run(executionId, options = {}) {
    const maxSteps = Math.max(1, Math.min(Number(options.maxSteps) || 25, 50));
    let processed = 0;
    while (processed < maxSteps) {
      let execution = await this.workflows.getExecution(executionId);
      if (!execution) throw new Error("Workflow execution not found.");
      if (TERMINAL.has(execution.status) || PAUSED.has(execution.status)) return { execution, processedSteps: processed };
      const workflow = await this.workflows.getWorkflow(execution.workflowId);
      if (!workflow) throw new Error("Workflow definition not found.");
      const step = currentStep(execution);
      if (!step) return { execution, processedSteps: processed };

      if (step.type === "APPROVAL") {
        const gate = findOutput(execution, workflow, "OWNED_COHERENCE_RIGHTS");
        const request = await this.approvals.request({
          subjectType: "WORKFLOW_EXECUTION",
          subjectId: execution.id,
          projectId: execution.projectId || null,
          title: gate?.status === "WAITING_REVIEW" ? "Content Factory: revisión editorial requerida" : "Content Factory: pieza lista para aprobación",
          message: gate?.status === "WAITING_REVIEW"
            ? "Una o más comprobaciones de coherencia/derechos necesitan revisión humana antes de continuar."
            : "La investigación, guion, derechos, narración y render superaron los controles automáticos. Revisa la pieza antes del DRY RUN de publicación.",
          details: { gate: gate || null, channelId: execution.input?.factoryChannelId, ownedContent: true },
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
        const message = error instanceof Error ? error.message : String(error);
        if (latest?.status === "processing" && isMediaRuntimeUnavailable(message)) {
          execution = await this.workflows.waitForInformation(executionId, {
            state: "WAITING_MEDIA_RUNTIME",
            reason: message,
            instruction: "Resume this execution on a ClipForge media runtime with FFmpeg/eSpeak available.",
          });
          return { execution, error: message, processedSteps: processed };
        }
        if (latest?.status === "processing") execution = await this.workflows.failCurrentStep(executionId, error, { retryable: true });
        else execution = latest || execution;
        return { execution, error: message, processedSteps: processed };
      }
    }
    return { execution: await this.workflows.getExecution(executionId), processedSteps: processed, limitReached: true };
  }

  async continueAfterHumanApproval(executionId) {
    const execution = await this.workflows.getExecution(executionId);
    if (!execution) throw new Error("Workflow execution not found.");
    if (execution.status !== "waiting_approval") throw new Error("Execution is not waiting for approval.");
    const approvals = await this.approvals.list({ subjectType: "WORKFLOW_EXECUTION", subjectId: execution.id });
    const approved = approvals.find((item) => item.status === "APPROVED");
    if (!approved) throw new Error("Owned-content execution has not received human approval.");
    await this.workflows.approveExecution(execution.id, { approvalId: approved.id, ownedContent: true });
    return this.run(execution.id);
  }

  async #executeStep(step, execution, workflow) {
    const input = execution.input || {};
    const channelId = input.factoryChannelId || input.channelId;
    if (!channelId) throw new Error("Owned-content execution has no channel.");

    if (step.type === "OWNED_TREND") {
      const sourceIds = await this.#ensureSources(input);
      const trend = input.trendId
        ? await this.trends.get(input.trendId)
        : await this.trends.ingest({
            channelId,
            topic: input.topic,
            category: input.category,
            sourceCount: sourceIds.length,
            observedAt: input.trendSignal?.observedAt || new Date().toISOString(),
            growthScore: input.trendSignal?.growthScore ?? 50,
            saturationScore: input.trendSignal?.saturationScore ?? 30,
            originalityPotential: input.trendSignal?.originalityPotential ?? 70,
            relevanceScore: input.trendSignal?.relevanceScore,
            historyFitScore: input.trendSignal?.historyFitScore,
            sourceSignals: input.trendSignal?.sourceSignals || [],
          }, input.profileSnapshot || {});
      if (!trend) throw new Error("Trend not found.");
      const selected = trend.selectedAt ? trend : await this.trends.select(trend.id);
      return { trendId: selected.id, trend: selected, sourceIds, humanSelected: true };
    }

    if (step.type === "OWNED_RESEARCH") {
      const trendOutput = findOutput(execution, workflow, "OWNED_TREND");
      const sourceIds = trendOutput?.sourceIds || input.sourceIds || [];
      const dossier = await this.research.research({
        channelId,
        trendId: trendOutput?.trendId || null,
        topic: input.topic || trendOutput?.trend?.topic,
        sourceIds,
        who: input.who,
        where: input.where,
      });
      return { researchId: dossier.id, dossier };
    }

    if (step.type === "OWNED_SCRIPT") {
      const dossier = findOutput(execution, workflow, "OWNED_RESEARCH")?.dossier;
      if (!dossier) throw new Error("Research dossier is missing.");
      const script = this.scripts.create({ research: dossier, language: input.language || input.profileSnapshot?.language, format: input.format || input.profileSnapshot?.defaultFormat || "SHORT" });
      if (script.status !== "READY") throw new Error(`Script cannot continue: ${script.reason}`);
      return { scriptId: script.id, script };
    }

    if (step.type === "OWNED_AUDIO") {
      const script = findOutput(execution, workflow, "OWNED_SCRIPT")?.script;
      if (!script) throw new Error("Script is missing before narration.");
      const result = await this.audio.render({
        channelId,
        contentId: execution.id,
        script,
        voiceProfile: input.voiceProfile || input.profileSnapshot?.voiceProfile,
        mode: input.ttsMode || "TTS_FREE",
        authorizedPremium: input.authorizedPremiumTts === true,
        estimatedPremiumCostUsd: input.estimatedPremiumTtsCostUsd,
        actualPremiumCostUsd: input.actualPremiumTtsCostUsd,
        musicAssetId: input.musicAssetId,
        budget: input.profileSnapshot?.budget || {},
      });
      return { audio: result };
    }

    if (step.type === "OWNED_VISUAL") {
      const dossier = findOutput(execution, workflow, "OWNED_RESEARCH")?.dossier;
      if (!dossier) throw new Error("Research dossier is missing before visual assembly.");
      const brand = input.brandId ? await this.brands.get(input.brandId) : null;
      const visualPlan = await this.visuals.prepare({
        projectId: execution.id,
        contentId: execution.id,
        channelId,
        research: dossier,
        brand,
        assetIds: input.visualAssetIds || [],
      });
      return { visualPlan };
    }

    if (step.type === "OWNED_RENDER") {
      const dossier = findOutput(execution, workflow, "OWNED_RESEARCH")?.dossier;
      const script = findOutput(execution, workflow, "OWNED_SCRIPT")?.script;
      const audio = findOutput(execution, workflow, "OWNED_AUDIO")?.audio;
      const visualPlan = findOutput(execution, workflow, "OWNED_VISUAL")?.visualPlan;
      const brand = input.brandId ? await this.brands.get(input.brandId) : null;
      const render = await this.renderer.render({
        projectId: execution.id,
        channelId,
        lineKey: input.profileSnapshot?.lineKey,
        researchId: dossier?.id,
        topic: dossier?.topic,
        category: input.category || "GENERAL",
        script,
        audio,
        visualPlan,
        brand,
        editTemplate: input.editTemplate || input.profileSnapshot?.editTemplate,
      });
      return { projectId: render.projectId, clipId: render.clipId, render };
    }

    if (step.type === "OWNED_COHERENCE_RIGHTS") {
      const dossier = findOutput(execution, workflow, "OWNED_RESEARCH")?.dossier;
      const script = findOutput(execution, workflow, "OWNED_SCRIPT")?.script;
      const visualPlan = findOutput(execution, workflow, "OWNED_VISUAL")?.visualPlan;
      const gate = this.gate.evaluate({ research: dossier, script, visualPlan, nearDuplicate: input.nearDuplicate === true });
      return gate;
    }

    if (step.type === "OWNED_DRY_RUN") {
      const render = findOutput(execution, workflow, "OWNED_RENDER");
      if (!render?.projectId || !render?.clipId) throw new Error("A READY owned-content clip is required for publication dry run.");
      const created = await this.publications.createForClip({
        projectId: render.projectId,
        clipId: render.clipId,
        channelId,
        approvalRequired: true,
        contentScope: "OWNED_CONTENT",
      });
      return {
        dryRun: true,
        realPublishingEnabled: ownedRealPublishingEnabled(),
        publicationId: created.publication.id,
        publication: created.publication,
        reused: created.reused,
        note: "DRY RUN only. Publication remains WAITING_APPROVAL and is never scheduled automatically.",
      };
    }

    if (step.type === "OWNED_ANALYTICS") {
      const performance = await this.performance.analyze({ channelId });
      return { performance };
    }

    throw new Error(`No owned-content handler for ${step.type}.`);
  }

  async #ensureSources(input) {
    const ids = [...new Set((Array.isArray(input.sourceIds) ? input.sourceIds : []).map(String))];
    if (ids.length >= 2) return ids;
    for (const sourceInput of Array.isArray(input.sources) ? input.sources : []) {
      const source = await this.sources.create(sourceInput);
      ids.push(source.id);
    }
    if ([...new Set(ids)].length < 2) throw new Error("Owned-content stories require at least two independent source inputs.");
    return [...new Set(ids)];
  }
}

function currentStep(execution) { return Number.isInteger(execution.currentStepIndex) ? execution.steps?.[execution.currentStepIndex] || null : null; }
function findOutput(execution, workflow, type) { for (let index = workflow.steps.length - 1; index >= 0; index -= 1) { const step = workflow.steps[index]; if (step.type !== type) continue; const value = execution.results?.[step.id]; if (value) return value; } return null; }
function isMediaRuntimeUnavailable(message) { return /not installed|configured path|espeak|ffmpeg|ffprobe/i.test(String(message || "")); }
function ownedRealPublishingEnabled() { return String(process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING || "").trim().toLowerCase() === "true"; }
