import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MarketingPlanRepository } from "../services/marketing-brain/MarketingPlanRepository.mjs";
import { ContentGenerationService } from "../services/content-generation/ContentGenerationService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-content-generation-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function savePlan(repository, overrides = {}) {
  const extractionId = randomUUID();
  const plan = {
    id: randomUUID(),
    projectId: PROJECT_ID,
    extractionIds: [extractionId],
    objective: "DEMONSTRATE",
    audience: "Hoteles pequeños de Costa Rica",
    channels: ["FACEBOOK_REELS", "INSTAGRAM_REELS"],
    format: "VERTICAL_VIDEO",
    message: "MetaBot responde consultas automáticamente y el plan indicado en la fuente cuesta ₡25.000.",
    cta: "Solicitá una demostración.",
    concept: "Mostrar una consulta y la respuesta automática usando material autorizado.",
    rationale: "La demostración presenta la función descrita en la fuente.",
    recommendedDurationSeconds: 18,
    evidence: [
      {
        extractionId,
        claim: "MetaBot responde consultas automáticamente.",
        evidence: "MetaBot responde consultas automáticamente.",
      },
    ],
    missingInformation: [],
    assumptions: [],
    mode: "DETERMINISTIC",
    provider: null,
    model: null,
    brief: {},
    createdAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
  await repository.save(plan);
  return plan;
}

test("generates three reviewable variants from one marketing plan", async () => {
  await withStorage(async () => {
    const plans = new MarketingPlanRepository();
    const plan = await savePlan(plans);
    const service = new ContentGenerationService({ plans });

    const generation = await service.generate({ planId: plan.id });

    assert.equal(generation.status, "DRAFT");
    assert.equal(generation.requiresApproval, true);
    assert.equal(generation.generationMode, "DETERMINISTIC");
    assert.equal(generation.projectId, PROJECT_ID);
    assert.equal(generation.variants.length, 3);
    assert.deepEqual(
      generation.variants.map((variant) => variant.angle),
      ["PROBLEM", "DEMONSTRATION", "BENEFIT"],
    );

    for (const variant of generation.variants) {
      assert.ok(variant.title.length > 0);
      assert.ok(variant.hook.length > 0);
      assert.ok(variant.description.includes("MetaBot responde consultas automáticamente"));
      assert.ok(variant.adCopy.includes("Solicitá una demostración."));
      assert.equal(variant.script.length, 3);
      assert.equal(variant.storyboard.length, 3);
      assert.equal(variant.subtitles.length, 3);
      assert.ok(variant.onScreenText.length >= 2);
      assert.deepEqual(variant.evidenceExtractionIds, plan.extractionIds);
      assert.ok(variant.hashtags.includes("#Reels"));
      assert.ok(variant.hashtags.includes("#Demostracion"));
    }

    const stored = await service.get(generation.id);
    assert.equal(stored.id, generation.id);
  });
});

test("variantCount can cheaply limit generation to one or two versions", async () => {
  await withStorage(async () => {
    const plans = new MarketingPlanRepository();
    const plan = await savePlan(plans);
    const service = new ContentGenerationService({ plans });

    const one = await service.generate({ planId: plan.id, variantCount: 1 });
    const two = await service.generate({ planId: plan.id, variantCount: 2 });

    assert.equal(one.variants.length, 1);
    assert.equal(one.variants[0].label, "A");
    assert.equal(two.variants.length, 2);
    assert.deepEqual(two.variants.map((variant) => variant.label), ["A", "B"]);
  });
});

test("non-video content does not fabricate timed video instructions", async () => {
  await withStorage(async () => {
    const plans = new MarketingPlanRepository();
    const plan = await savePlan(plans, {
      format: "STATIC_POST",
      channels: ["FACEBOOK_POST"],
      objective: "PRESENT_SERVICE",
      recommendedDurationSeconds: null,
    });
    const service = new ContentGenerationService({ plans });

    const generation = await service.generate({ planId: plan.id });
    for (const variant of generation.variants) {
      assert.deepEqual(variant.script, []);
      assert.deepEqual(variant.storyboard, []);
      assert.deepEqual(variant.subtitles, []);
      assert.ok(variant.adCopy.length > 0);
    }
  });
});

test("content generation fails when the marketing plan does not exist", async () => {
  await withStorage(async () => {
    const service = new ContentGenerationService();
    await assert.rejects(
      () => service.generate({ planId: randomUUID() }),
      /Marketing plan not found/i,
    );
  });
});

test("invalid variant counts are rejected", async () => {
  await withStorage(async () => {
    const plans = new MarketingPlanRepository();
    const plan = await savePlan(plans);
    const service = new ContentGenerationService({ plans });

    await assert.rejects(
      () => service.generate({ planId: plan.id, variantCount: 4 }),
      /between 1 and 3/i,
    );
  });
});
