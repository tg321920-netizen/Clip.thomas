import test from "node:test";
import assert from "node:assert/strict";
import { runAutoEditBatch } from "../services/autoedit/AutoEditBatchService.mjs";

test("Auto Edit batch keeps successful clips when another candidate fails", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const project = {
    analysis: {
      candidates: [
        { id: "candidate-1", viralScore: 90, startTime: 0 },
        { id: "candidate-2", viralScore: 80, startTime: 40 },
        { id: "candidate-3", viralScore: 70, startTime: 80 },
      ],
    },
  };
  const queued = [];
  const progress = [];

  const result = await runAutoEditBatch({
    projectId,
    project,
    payload: {
      candidateIds: ["candidate-1", "candidate-2", "candidate-3"],
    },
    async prepareAutoEdit(_projectId, options) {
      if (options.candidateId === "candidate-2") {
        throw new Error("provider failed only for candidate-2");
      }
      return {
        reused: false,
        plan: { candidateId: options.candidateId },
        clip: {
          id: `clip-${options.candidateId}`,
          candidateId: options.candidateId,
          status: "DRAFT",
        },
      };
    },
    store: {
      async getRenderJob() {
        return null;
      },
      async enqueueRender(_projectId, clipId) {
        queued.push(clipId);
        return { id: `job-${clipId}`, status: "QUEUED" };
      },
    },
    async markClipQueued() {},
    async onProgress(value) {
      progress.push(value);
    },
  });

  assert.deepEqual(result.candidateIds, ["candidate-1", "candidate-3"]);
  assert.deepEqual(result.clipIds, ["clip-candidate-1", "clip-candidate-3"]);
  assert.deepEqual(queued, ["clip-candidate-1", "clip-candidate-3"]);
  assert.equal(result.partialFailures.length, 1);
  assert.equal(result.partialFailures[0].candidateId, "candidate-2");
  assert.match(result.partialFailures[0].error, /provider failed/);
  assert.equal(progress.length, 3);
});

test("Auto Edit batch fails only when every selected candidate fails", async () => {
  await assert.rejects(
    runAutoEditBatch({
      projectId: "11111111-1111-4111-8111-111111111111",
      project: {
        analysis: { candidates: [{ id: "candidate-1", viralScore: 90 }] },
      },
      payload: { candidateIds: ["candidate-1"] },
      async prepareAutoEdit() {
        throw new Error("total failure");
      },
      store: {},
    }),
    /All Auto Edit candidates failed: total failure/,
  );
});
