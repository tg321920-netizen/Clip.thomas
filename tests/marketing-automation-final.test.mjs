import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrandService } from "../services/branding/BrandService.mjs";
import { ApprovalService } from "../services/approvals/ApprovalService.mjs";
import { ContentGenerationRepository } from "../services/content-generation/ContentGenerationRepository.mjs";
import { MarketingEditService } from "../services/media-processing/MarketingEditService.mjs";
import { MarketingPublishingHub } from "../services/publishing/MarketingPublishingHub.mjs";
import { WorkflowRecipeService } from "../services/workflows/WorkflowRecipeService.mjs";
import { MarketingWorkflowRunner } from "../services/workflows/MarketingWorkflowRunner.mjs";
import { WorkflowService } from "../services/workflows/WorkflowService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-marketing-final-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  const previousPublish = process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  try { await fn(); }
  finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    if (previousPublish === undefined) delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
    else process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING = previousPublish;
    await rm(root, { recursive: true, force: true });
  }
}

test("marketing workflow runs through content, pauses for human approval, then resumes", async () => {
  await withStorage(async () => {
    const workflows = new WorkflowService();
    const workflow = await workflows.createWorkflow({
      name: "Runner test",
      steps: [
        { id: "source", type: "SOURCE" },
        { id: "extract", type: "EXTRACT" },
        { id: "understand", type: "UNDERSTAND" },
        { id: "idea", type: "IDEA" },
        { id: "content", type: "CONTENT" },
        { id: "approval", type: "APPROVAL", requiresApproval: true },
      ],
    });
    const created = await workflows.createExecution(workflow.id, {
      input: {
        source: {
          type: "TEXT",
          text: "MetaBot responde consultas de hoteles pequeños y permite solicitar una demostración.",
        },
        brief: {
          mode: "DETERMINISTIC",
          objective: "DEMONSTRATE",
          audience: "Hoteles pequeños de Costa Rica",
          channels: ["FACEBOOK_REELS", "INSTAGRAM_REELS"],
          format: "VERTICAL_VIDEO",
        },
      },
    });

    const runner = new MarketingWorkflowRunner({ workflows });
    const paused = await runner.run(created.execution.id);
    assert.equal(paused.execution.status, "waiting_approval");
    assert.ok(paused.approval?.id);

    const contentResult = paused.execution.results.content;
    assert.ok(contentResult.generationId);
    const repository = new ContentGenerationRepository();
    const generation = await repository.get(contentResult.generationId);
    assert.equal(generation.status, "WAITING_APPROVAL");
    assert.equal(generation.variants.length, 3);

    await new ApprovalService().approve(paused.approval.id, {
      selectedVariantId: generation.variants[0].id,
    });
    const resumed = await runner.continueAfterHumanApproval(created.execution.id);
    assert.equal(resumed.execution.status, "completed");
  });
});

test("Publishing Hub remains dry-run and blocks live handoff by default", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const generation = {
      id: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      projectId: null,
      format: "VERTICAL_VIDEO",
      channels: ["FACEBOOK_REELS"],
      status: "APPROVED",
      requiresApproval: true,
      generationMode: "DETERMINISTIC",
      approvalId: crypto.randomUUID(),
      selectedVariantId: null,
      reviewNote: null,
      reviewedAt: new Date().toISOString(),
      variants: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const variantId = crypto.randomUUID();
    generation.selectedVariantId = variantId;
    generation.variants.push({
      id: variantId,
      label: "A",
      angle: "PROBLEM",
      title: "MetaBot",
      hook: "¿Respondés a tiempo?",
      description: "Demostración de MetaBot.",
      adCopy: "Demostración de MetaBot.",
      cta: "Solicitá una demostración.",
      hashtags: ["#MetaBot"],
      script: [], storyboard: [], subtitles: [], onScreenText: [], evidenceExtractionIds: [],
    });
    await content.save(generation);

    const hub = new MarketingPublishingHub({ content });
    const first = await hub.simulate({ generationId: generation.id, platform: "FACEBOOK" });
    const second = await hub.simulate({ generationId: generation.id, platform: "FACEBOOK" });
    assert.equal(first.simulation.dryRun, true);
    assert.equal(first.simulation.label, "Simulación de publicación");
    assert.equal(second.reused, true);
    await assert.rejects(() => hub.handoffToAuthorizedPublishing(first.simulation.id), /approval is required/i);
  });
});

test("brand profiles are reusable and automatic editing rejects unapproved content", async () => {
  await withStorage(async () => {
    const brands = new BrandService();
    const brand = await brands.create({
      name: "MetaBot",
      colors: { primary: "#6d28d9" },
      preferredCta: "Solicitá una demostración",
      tone: "Claro y directo",
    });
    const applied = brands.applyToVariant(brand, { id: "variant", cta: "Otro CTA" });
    assert.equal(applied.variant.cta, "Solicitá una demostración");
    assert.equal(applied.variant.brandOverlay.name, "MetaBot");

    const content = new ContentGenerationRepository();
    const generation = {
      id: crypto.randomUUID(), planId: crypto.randomUUID(), projectId: null,
      format: "VERTICAL_VIDEO", channels: [], status: "DRAFT", requiresApproval: true,
      generationMode: "DETERMINISTIC", variants: [{ id: crypto.randomUUID() }],
      selectedVariantId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await content.save(generation);
    const edits = new MarketingEditService({ content, brands });
    await assert.rejects(() => edits.prepare({ generationId: generation.id, brandId: brand.id }), /human-approved/i);
  });
});

test("recipe catalog includes the five requested starting recipes", () => {
  const keys = new WorkflowRecipeService().listRecipes().map((item) => item.key);
  assert.deepEqual(keys, [
    "VIDEO_TO_CLIPS",
    "PRODUCT_TO_AD",
    "COMPANY_WEEK_CONTENT",
    "METABOT_ADVERTISING",
    "URL_TO_CONTENT",
  ]);
});
