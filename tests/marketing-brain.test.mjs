import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceRepository } from "../services/sources/SourceRepository.mjs";
import { MarketingBrainService } from "../services/marketing-brain/MarketingBrainService.mjs";

const PROJECT_A = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const PROJECT_B = "9e56073f-ae3a-4c2c-a73d-b11085dbd1b7";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-marketing-brain-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousMode = process.env.CLIPFORGE_MARKETING_BRAIN_MODE;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_MARKETING_BRAIN_MODE;

  try {
    await fn(root);
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousMode === undefined) delete process.env.CLIPFORGE_MARKETING_BRAIN_MODE;
    else process.env.CLIPFORGE_MARKETING_BRAIN_MODE = previousMode;
    await rm(root, { recursive: true, force: true });
  }
}

async function saveExtraction(repository, overrides = {}) {
  const id = randomUUID();
  const record = {
    id,
    sourceId: randomUUID(),
    sourceType: "TEXT",
    projectId: null,
    status: "COMPLETED",
    text:
      "MetaBot responde consultas automáticamente. Plan ₡25.000. " +
      "Solicitá una demostración por WhatsApp al +506 8888-7777.",
    summary: "MetaBot responde consultas automáticamente. Plan ₡25.000.",
    signals: {
      prices: ["₡25.000"],
      emails: [],
      phones: ["+506 8888-7777"],
      urls: [],
      hours: [],
      ctaCandidates: ["Solicitá una demostración por WhatsApp al +506 8888-7777."],
    },
    metadata: {},
    error: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    completedAt: "2026-09-28T12:00:01.000Z",
    ...overrides,
  };
  await repository.saveExtraction(record);
  return record;
}

test("deterministic Marketing Brain honors the user brief without requiring AI", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const extraction = await saveExtraction(repository, { projectId: PROJECT_A });
    const brain = new MarketingBrainService({
      sources: repository,
      resolveConfig: () => ({ apiKey: "", model: "", baseUrl: "https://api.openai.com/v1" }),
    });

    const plan = await brain.createPlan({
      extractionIds: [extraction.id],
      objective: "DEMONSTRATE",
      audience: "Hoteles pequeños de Costa Rica",
      channels: ["FACEBOOK_REELS", "INSTAGRAM_REELS"],
      format: "VERTICAL_VIDEO",
      mode: "DETERMINISTIC",
    });

    assert.equal(plan.mode, "DETERMINISTIC");
    assert.equal(plan.provider, null);
    assert.equal(plan.model, null);
    assert.equal(plan.projectId, PROJECT_A);
    assert.equal(plan.objective, "DEMONSTRATE");
    assert.equal(plan.audience, "Hoteles pequeños de Costa Rica");
    assert.deepEqual(plan.channels, ["FACEBOOK_REELS", "INSTAGRAM_REELS"]);
    assert.equal(plan.format, "VERTICAL_VIDEO");
    assert.equal(plan.recommendedDurationSeconds, 18);
    assert.ok(plan.evidence.some((item) => item.evidence === "₡25.000"));
    assert.ok(plan.cta.includes("demostración") || plan.cta.includes("WhatsApp"));

    const stored = await brain.get(plan.id);
    assert.equal(stored.id, plan.id);
  });
});

test("AUTO mode falls back to deterministic planning when no AI provider is configured", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const extraction = await saveExtraction(repository);
    let aiCalls = 0;
    const brain = new MarketingBrainService({
      sources: repository,
      resolveConfig: () => ({ apiKey: "", model: "", baseUrl: "https://api.openai.com/v1" }),
      requestJson: async () => {
        aiCalls += 1;
        throw new Error("AI should not be called");
      },
    });

    const plan = await brain.createPlan({ extractionIds: [extraction.id], mode: "AUTO" });
    assert.equal(plan.mode, "DETERMINISTIC");
    assert.equal(aiCalls, 0);
    assert.deepEqual(plan.channels, ["INSTAGRAM_REELS", "FACEBOOK_REELS"]);
    assert.ok(plan.missingInformation.includes("Público objetivo específico."));
  });
});

test("AI plan keeps only evidence that can be verified in the extraction", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const extraction = await saveExtraction(repository, { projectId: PROJECT_A });
    const usageRecords = [];
    const brain = new MarketingBrainService({
      sources: repository,
      resolveConfig: () => ({
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "https://api.example-ai.test/v1",
        apiStyle: "responses",
        temperature: 0.2,
        maxOutputTokens: 1800,
      }),
      requestJson: async () => ({
        parsed: {
          objective: "GENERATE_INTEREST",
          audience: "Audience invented by model",
          channels: ["TIKTOK"],
          format: "VERTICAL_VIDEO",
          message: "Mostrar cómo MetaBot responde consultas.",
          cta: "Solicitá una demostración.",
          concept: "Una consulta entra y se muestra una respuesta rápida.",
          rationale: "La demostración hace visible la función descrita en la fuente.",
          recommendedDurationSeconds: 20,
          evidence: [
            {
              extractionId: extraction.id,
              claim: "MetaBot responde consultas automáticamente.",
              evidence: "MetaBot responde consultas automáticamente.",
            },
            {
              extractionId: extraction.id,
              claim: "Tiene integración garantizada con 40 sistemas.",
              evidence: "integración garantizada con 40 sistemas",
            },
          ],
          missingInformation: ["No se indica tiempo de implementación."],
          assumptions: [],
        },
        usage: { inputTokens: 321, outputTokens: 123 },
      }),
      usage: {
        record: async (record) => {
          usageRecords.push(record);
          return record;
        },
      },
    });

    const plan = await brain.createPlan({
      extractionIds: [extraction.id],
      objective: "GET_CLIENTS",
      audience: "Hoteles pequeños de Costa Rica",
      channels: ["FACEBOOK_REELS", "INSTAGRAM_REELS"],
      mode: "AI",
    });

    assert.equal(plan.mode, "AI");
    assert.equal(plan.provider, "api.example-ai.test");
    assert.equal(plan.model, "test-model");
    assert.equal(plan.objective, "GET_CLIENTS");
    assert.equal(plan.audience, "Hoteles pequeños de Costa Rica");
    assert.deepEqual(plan.channels, ["FACEBOOK_REELS", "INSTAGRAM_REELS"]);
    assert.equal(plan.evidence.length, 1);
    assert.equal(plan.evidence[0].evidence, "MetaBot responde consultas automáticamente.");
    assert.ok(
      plan.assumptions.some((value) => value.includes("Se descartaron afirmaciones de evidencia")),
    );
    assert.equal(usageRecords.length, 1);
    assert.equal(usageRecords[0].operation, "marketing-brain-plan");
    assert.equal(usageRecords[0].inputTokens, 321);
    assert.equal(usageRecords[0].outputTokens, 123);
  });
});

test("Marketing Brain rejects extractions that belong to different projects", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const first = await saveExtraction(repository, { projectId: PROJECT_A });
    const second = await saveExtraction(repository, { projectId: PROJECT_B });
    const brain = new MarketingBrainService({
      sources: repository,
      resolveConfig: () => ({ apiKey: "", model: "", baseUrl: "https://api.openai.com/v1" }),
    });

    await assert.rejects(
      () =>
        brain.createPlan({
          extractionIds: [first.id, second.id],
          mode: "DETERMINISTIC",
        }),
      /different ClipForge projects/i,
    );
  });
});

test("forced AI mode fails closed when AI credentials are not configured", async () => {
  await withStorage(async () => {
    const repository = new SourceRepository();
    const extraction = await saveExtraction(repository);
    const brain = new MarketingBrainService({
      sources: repository,
      resolveConfig: () => ({ apiKey: "", model: "", baseUrl: "https://api.openai.com/v1" }),
    });

    await assert.rejects(
      () => brain.createPlan({ extractionIds: [extraction.id], mode: "AI" }),
      /requires CLIPFORGE_AI_API_KEY/i,
    );
  });
});
