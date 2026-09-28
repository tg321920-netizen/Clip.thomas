import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AutopilotService,
  selectAutopilotCandidates,
} from "../services/autopilot/AutopilotService.mjs";

test("Autopilot selects several scored candidates and schedules each ready clip without duplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autopilot-multi-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  const projectId = randomUUID();
  const channelId = randomUUID();
  const candidates = [
    candidate("candidate-0001", 0, 30, 91),
    candidate("candidate-0002", 60, 95, 84),
    candidate("candidate-0003", 130, 160, 72),
    candidate("candidate-0004", 180, 210, 40),
  ];
  const clips = candidates.slice(0, 3).map((item) => ({
    id: randomUUID(),
    candidateId: item.id,
    status: "READY",
    render: { relativePath: `clips/${projectId}/${item.id}.mp4` },
    autoEdit: { candidateId: item.id, createdAt: new Date().toISOString() },
  }));

  try {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await writeFile(
      path.join(root, "projects", `${projectId}.json`),
      JSON.stringify({
        id: projectId,
        createdAt: new Date().toISOString(),
        source: {
          projectId,
          videoId: randomUUID(),
          originalName: "multi.mp4",
          storedName: "source.mp4",
          relativePath: `uploads/${projectId}/source.mp4`,
          sizeBytes: 1234,
          durationSeconds: 240,
        },
        transcript: {
          id: "transcript-1",
          status: "COMPLETED",
          segments: [{ id: "s1", startTime: 0, endTime: 240, text: "contenido" }],
        },
        analysis: { id: "analysis-1", status: "COMPLETED", candidates },
        clips,
      }, null, 2),
      "utf8",
    );

    const selection = selectAutopilotCandidates(
      { analysis: { candidates } },
      {
        clipsPerSource: 3,
        minClipScore: 55,
        minClipDuration: 15,
        maxClipDuration: 60,
      },
    );
    assert.deepEqual(selection.map((item) => item.id), [
      "candidate-0001",
      "candidate-0002",
      "candidate-0003",
    ]);

    const publicationByPair = new Map();
    let createCalls = 0;
    let scheduleCalls = 0;
    const service = new AutopilotService({
      channels: {
        async listChannels() {
          return [{
            id: channelId,
            platform: "YOUTUBE",
            status: "CONNECTED",
            publishingEnabled: true,
            dailyLimit: 10,
          }];
        },
      },
      publications: {
        async createForClip(input) {
          createCalls += 1;
          const key = `${input.clipId}:${input.channelId}`;
          if (!publicationByPair.has(key)) {
            publicationByPair.set(key, {
              id: randomUUID(),
              status: "APPROVED",
              clipId: input.clipId,
            });
          }
          return { reused: createCalls > 3, publication: publicationByPair.get(key) };
        },
        async approve(publicationId) {
          return { id: publicationId, status: "APPROVED" };
        },
      },
      scheduler: {
        async schedulePublication(publicationId) {
          scheduleCalls += 1;
          return {
            scheduled: true,
            publication: { id: publicationId, status: "SCHEDULED" },
          };
        },
      },
    });

    const config = await service.updateConfig({
      enabled: true,
      mode: "AUTOPILOT",
      approvalRequired: false,
      platforms: ["YOUTUBE"],
      clipsPerSource: 3,
      minClipScore: 55,
      minClipDuration: 15,
      maxClipDuration: 60,
    });

    const result = await service.advanceProject(projectId, { config });
    assert.equal(result.state, "PUBLICATIONS_SCHEDULED");
    assert.equal(result.clipIds.length, 3);
    assert.deepEqual(new Set(result.clipIds), new Set(clips.map((clip) => clip.id)));
    assert.equal(result.publicationIds.length, 3);
    assert.equal(createCalls, 3);
    assert.equal(scheduleCalls, 3);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

function candidate(id, startTime, endTime, viralScore) {
  return {
    id,
    startTime,
    endTime,
    duration: endTime - startTime,
    viralScore,
    title: id,
    hook: id,
    text: `texto ${id}`,
  };
}
