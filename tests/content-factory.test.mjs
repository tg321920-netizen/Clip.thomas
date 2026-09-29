import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApprovalService } from "../services/approvals/ApprovalService.mjs";
import { BrandService } from "../services/branding/BrandService.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentGenerationRepository } from "../services/content-generation/ContentGenerationRepository.mjs";
import { ContentFactoryService } from "../services/content-factory/ContentFactoryService.mjs";
import { MarketingWorkflowRunner } from "../services/workflows/MarketingWorkflowRunner.mjs";
import { WorkflowService } from "../services/workflows/WorkflowService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-factory-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousPublishing = process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  try {
    await fn();
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousPublishing === undefined) delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
    else process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING = previousPublishing;
    await rm(root, { recursive: true, force: true });
  }
}

test("Content Factory keeps channel configuration independent while reusing Channel and Brand services", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const brands = new BrandService();
    const factory = new ContentFactoryService({ channels, brands });

    const tiktok = await channels.createChannel({
      platform: "TIKTOK",
      name: "Gaming CR",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 3,
    });
    const youtube = await channels.createChannel({
      platform: "YOUTUBE",
      name: "Negocios ES",
      timezone: "Europe/Madrid",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 2,
    });
    const gamingBrand = await brands.create({ name: "Gaming Brand", tone: "Energético" });
    const businessBrand = await brands.create({ name: "Business Brand", tone: "Profesional" });

    await factory.configure(tiktok.id, {
      enabled: true,
      brandId: gamingBrand.id,
      language: "es-CR",
      niche: "gaming y streams",
      recipeKey: "VIDEO_TO_CLIPS",
      postsPerDay: 4,
      preferredTimes: ["17:00", "21:00"],
      editTemplate: { framingMode: "FILL", quality: "FAST", subtitleStyle: "KARAOKE" },
      strategy: { systemPrompt: "Priorizar momentos de reacción y humor." },
    });
    await factory.configure(youtube.id, {
      enabled: true,
      brandId: businessBrand.id,
      language: "es-ES",
      niche: "marketing para pymes",
      recipeKey: "PRODUCT_TO_AD",
      postsPerDay: 1,
      preferredTimes: ["10:00"],
      editTemplate: { framingMode: "FIT", quality: "HIGH", subtitleStyle: "CLEAN" },
      strategy: { systemPrompt: "Mantener tono profesional y educativo." },
    });

    const first = await factory.getChannelView(tiktok.id);
    const second = await factory.getChannelView(youtube.id);

    assert.equal(first.channel.platform, "TIKTOK");
    assert.equal(second.channel.platform, "YOUTUBE");
    assert.equal(first.profile.brandId, gamingBrand.id);
    assert.equal(second.profile.brandId, businessBrand.id);
    assert.equal(first.profile.language, "es-CR");
    assert.equal(second.profile.language, "es-ES");
    assert.equal(first.profile.niche, "gaming y streams");
    assert.equal(second.profile.niche, "marketing para pymes");
    assert.deepEqual(first.profile.editTemplate, { framingMode: "FILL", quality: "FAST", subtitleStyle: "KARAOKE" });
    assert.deepEqual(second.profile.editTemplate, { framingMode: "FIT", quality: "HIGH", subtitleStyle: "CLEAN" });
    assert.equal(first.channel.dailyLimit, 4);
    assert.equal(first.channel.strategy.dailyPostLimit, 4);
    assert.equal(second.channel.dailyLimit, 1);
    assert.equal(second.channel.strategy.dailyPostLimit, 1);
    assert.equal(first.channel.strategy.systemPrompt, "Priorizar momentos de reacción y humor.");
    assert.equal(second.channel.strategy.systemPrompt, "Mantener tono profesional y educativo.");
    assert.equal(first.realPublishingEnabled, false);

    const dashboard = await factory.listDashboard();
    assert.equal(dashboard.channels.length, 2);
    assert.deepEqual(Object.keys(dashboard.totals).sort(), [
      "failed", "pending", "processing", "published", "ready", "scheduled", "waitingApproval",
    ].sort());
  });
});

test("Content Factory reuses marketing workflow through A/B/C, approval, branding, edit preparation and DRY RUN", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const brands = new BrandService();
    const workflows = new WorkflowService();
    const factory = new ContentFactoryService({ channels, brands, workflows });

    const channel = await channels.createChannel({
      platform: "FACEBOOK",
      name: "Pyme CR",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 2,
    });
    const brand = await brands.create({
      name: "Pyme Clara",
      preferredCta: "Solicitá información",
      colors: { primary: "#663399" },
      tone: "Claro y directo",
    });

    await factory.configure(channel.id, {
      enabled: true,
      brandId: brand.id,
      language: "es-CR",
      niche: "pequeños negocios",
      recipeKey: "PRODUCT_TO_AD",
      postsPerDay: 2,
      preferredTimes: ["09:00", "18:00"],
      editTemplate: { framingMode: "FILL", quality: "BALANCED", subtitleStyle: "VIRAL" },
      strategy: { systemPrompt: "Explicar beneficios sin exageraciones." },
    });

    const started = await factory.start(channel.id, {
      idempotencyKey: "factory-marketing-e2e",
      source: {
        type: "TEXT",
        text: "ClipForge ayuda a pequeñas empresas a transformar información autorizada en contenido corto listo para revisar y publicar.",
      },
      brief: {
        objective: "DEMONSTRATE",
        audience: "pequeños negocios de Costa Rica",
      },
    });

    assert.equal(started.reused, false);
    assert.equal(started.run.execution.status, "waiting_approval");
    assert.ok(started.run.approval?.id);

    const generationId = started.run.execution.results.content.generationId;
    const content = new ContentGenerationRepository();
    const generation = await content.get(generationId);
    assert.equal(generation.status, "WAITING_APPROVAL");
    assert.equal(generation.variants.length, 3);
    assert.deepEqual(generation.variants.map((item) => item.label), ["A", "B", "C"]);

    await new ApprovalService().approve(started.run.approval.id, {
      selectedVariantId: generation.variants[1].id,
    });

    const resumed = await new MarketingWorkflowRunner({ workflows }).continueAfterHumanApproval(started.execution.id);
    assert.equal(resumed.execution.status, "completed");
    assert.equal(resumed.execution.results.edit.edit.status, "WAITING_SOURCE_ASSET");
    assert.equal(resumed.execution.results.edit.edit.brandSnapshot.id, brand.id);
    assert.equal(resumed.execution.results.brand.applied, true);
    assert.equal(resumed.execution.results.publish.dryRun, true);
    assert.equal(resumed.execution.results.publish.simulation.dryRun, true);
    assert.equal(resumed.execution.results.publish.simulation.label, "Simulación de publicación");
    assert.equal(resumed.execution.results.publish.simulation.channelId, channel.id);

    const duplicate = await factory.start(channel.id, {
      idempotencyKey: "factory-marketing-e2e",
      source: { type: "TEXT", text: "No debería crear otra ejecución." },
    });
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.execution.id, started.execution.id);
  });
});
