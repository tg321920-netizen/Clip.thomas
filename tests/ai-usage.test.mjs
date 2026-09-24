import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIUsageService, estimateCostUsd } from "../services/ai/AIUsageService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

test("AIUsageService records token usage and deduplicates by provider request id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-ai-usage-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const service = new AIUsageService();
    const first = await service.record({
      provider: "openai",
      model: "test-model",
      operation: "AUTO_EDIT",
      projectId: PROJECT_ID,
      externalRequestId: "resp_123",
      inputTokens: 1000,
      outputTokens: 500,
      inputRatePerMillion: 2,
      outputRatePerMillion: 8,
    });
    const duplicate = await service.record({
      provider: "openai",
      model: "test-model",
      operation: "AUTO_EDIT",
      projectId: PROJECT_ID,
      externalRequestId: "resp_123",
      inputTokens: 1000,
      outputTokens: 500,
      inputRatePerMillion: 2,
      outputRatePerMillion: 8,
    });

    assert.equal(first.reused, false);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.record.id, first.record.id);
    assert.equal(first.record.estimatedCostUsd, 0.006);

    const summary = await service.summary({ projectId: PROJECT_ID });
    assert.equal(summary.requests, 1);
    assert.equal(summary.totalTokens, 1500);
    assert.equal(summary.knownEstimatedCostUsd, 0.006);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("AI cost stays unknown when pricing is not configured", () => {
  assert.equal(
    estimateCostUsd({
      inputTokens: 1000,
      outputTokens: 500,
      inputRatePerMillion: null,
      outputRatePerMillion: null,
    }),
    null,
  );
});
