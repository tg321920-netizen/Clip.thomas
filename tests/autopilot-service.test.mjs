import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AutopilotService,
  normalizeConfig,
} from "../services/autopilot/AutopilotService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const CLIP_ID = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";
const CHANNEL_ID = "0f99f199-192d-4900-95c6-dbbb60130ee8";
const PUBLICATION_ID = "9f3d14d5-69f7-4acb-b687-f2b50fbf4d79";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autopilot-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function baseProject() {
  return {
    id: PROJECT_ID,
    createdAt: "2026-09-22T00:00:00.000Z",
    source: {
      projectId: PROJECT_ID,
      videoId: "d5944590-af07-41d8-ad70-4863bb8d83ac",
      originalName: "source.mp4",
      storedName: "source.mp4",
      sizeBytes: 1000,
      durationSeconds: 90,
      relativePath: `uploads/${PROJECT_ID}/source.mp4`,
    },
  };
}

function completedTranscript() {
  return {
    id: "transcript-1",
    status: "COMPLETED",
    segments: [
      { id: "segment-1", startTime: 0, endTime: 20, text: "Texto real." },
    ],
    completedAt: "2026-09-22T00:01:00.000Z",
  };
}

function completedAnalysis() {
  return {
    id: "analysis-1",
    status: "COMPLETED",
    candidates: [
      {
        id: "candidate-0001",
        startTime: 0,
        endTime: 20,
        duration: 20,
        title: "Candidato",
        hook: "Hook",
        text: "Texto real.",
        viralScore: 75,
      },
    ],
    completedAt: "2026-09-22T00:02:00.000Z",
  };
}

function readyProject() {
  return {
    ...baseProject(),
    transcript: completedTranscript(),
    analysis: completedAnalysis(),
    clips: [
      {
        id: CLIP_ID,
        candidateId: "candidate-0001",
        status: "READY",
        render: {
          relativePath: `clips/${PROJECT_ID}/${CLIP_ID}/render.mp4`,
        },
        autoEdit: {
          candidateId: "candidate-0001",
          createdAt: "2026-09-22T00:03:00.000Z",
        },
      },
    ],
  };
}

async function saveProject(root, project) {
  await writeFile(
    path.join(root, "projects", `${PROJECT_ID}.json`),
    JSON.stringify(project, null, 2),
    "utf8",
  );
}

function eligibleChannels() {
  return {
    async listChannels() {
      return [
        {
          id: CHANNEL_ID,
          platform: "TIKTOK",
          status: "CONNECTED",
          publishingEnabled: true,
          dailyLimit: 3,
        },
        {
          id: "46bab00e-f7e8-4b58-ab22-e727409d1cf9",
          platform: "FACEBOOK",
          status: "PAUSED",
          publishingEnabled: true,
          dailyLimit: 2,
        },
      ];
    },
  };
}

test("default Autopilot is manual, disabled and requires approval", async () => {
  await withStorage(async () => {
    const service = new AutopilotService();
    const config = await service.getConfig();

    assert.equal(config.enabled, false);
    assert.equal(config.mode, "MANUAL");
    assert.equal(config.approvalRequired, true);
    assert.deepEqual(config.platforms, ["TIKTOK", "YOUTUBE", "FACEBOOK"]);
  });
});

test("Autopilot config validates preferred times and platforms", () => {
  assert.throws(
    () => normalizeConfig({ platforms: [], preferredTimes: ["09:00"] }),
    /at least one supported platform/i,
  );
  assert.throws(
    () =>
      normalizeConfig({
        platforms: ["TIKTOK"],
        preferredTimes: ["25:99"],
      }),
    /invalid preferred time/i,
  );
});

test("project orchestration enqueues only the next missing stage", async () => {
  await withStorage(async (root) => {
    const service = new AutopilotService();
    const config = await service.updateConfig({
      enabled: true,
      mode: "AUTOPILOT",
    });

    await saveProject(root, baseProject());
    const transcription = await service.advanceProject(PROJECT_ID, { config });
    assert.equal(transcription.state, "WAITING_TRANSCRIPTION");
    assert.equal(transcription.queuedJob.type, "TRANSCRIBE_VIDEO");

    const withTranscript = {
      ...baseProject(),
      transcript: completedTranscript(),
    };
    await saveProject(root, withTranscript);
    const analysis = await service.advanceProject(PROJECT_ID, { config });
    assert.equal(analysis.state, "WAITING_ANALYSIS");
    assert.equal(analysis.queuedJob.type, "ANALYZE_VIDEO");

    const withAnalysis = {
      ...withTranscript,
      analysis: completedAnalysis(),
    };
    await saveProject(root, withAnalysis);
    const autoEdit = await service.advanceProject(PROJECT_ID, { config });
    assert.equal(autoEdit.state, "WAITING_AUTO_EDIT");
    assert.equal(autoEdit.queuedJob.type, "AUTO_EDIT");
  });
});

test("ready clip creates one approval-gated publication per eligible channel", async () => {
  await withStorage(async (root) => {
    let createCalls = 0;
    const publications = {
      async createForClip(input) {
        createCalls += 1;
        assert.equal(input.clipId, CLIP_ID);
        assert.equal(input.channelId, CHANNEL_ID);
        assert.equal(input.approvalRequired, true);
        return {
          reused: createCalls > 1,
          publication: {
            id: PUBLICATION_ID,
            status: "WAITING_APPROVAL",
          },
        };
      },
    };
    const scheduler = {
      async schedulePublication() {
        throw new Error("Approval-gated publication must not be scheduled.");
      },
    };

    const service = new AutopilotService({
      channels: eligibleChannels(),
      publications,
      scheduler,
    });
    const config = await service.updateConfig({
      enabled: true,
      mode: "AUTOPILOT",
      platforms: ["TIKTOK", "FACEBOOK"],
      approvalRequired: true,
    });

    await saveProject(root, readyProject());
    const first = await service.advanceProject(PROJECT_ID, { config });
    const second = await service.advanceProject(PROJECT_ID, { config });

    assert.equal(first.state, "WAITING_APPROVAL");
    assert.equal(first.clipId, CLIP_ID);
    assert.equal(first.approvalRequired, true);
    assert.deepEqual(first.eligibleChannelIds, [CHANNEL_ID]);
    assert.deepEqual(first.publicationIds, [PUBLICATION_ID]);
    assert.equal(second.state, "WAITING_APPROVAL");
    assert.equal(createCalls, 2);
  });
});

test("approval-disabled Autopilot schedules idempotent publications", async () => {
  await withStorage(async (root) => {
    const publications = {
      async createForClip(input) {
        assert.equal(input.approvalRequired, false);
        return {
          reused: true,
          publication: {
            id: PUBLICATION_ID,
            status: "APPROVED",
          },
        };
      },
      async approve() {
        throw new Error("Already approved publication must not need approval.");
      },
    };
    let scheduleCalls = 0;
    const scheduler = {
      async schedulePublication(publicationId) {
        scheduleCalls += 1;
        assert.equal(publicationId, PUBLICATION_ID);
        return {
          scheduled: scheduleCalls === 1,
          reason: scheduleCalls === 1 ? "SCHEDULED" : "ALREADY_SCHEDULED",
          publication: {
            id: PUBLICATION_ID,
            status: "SCHEDULED",
          },
        };
      },
    };

    const service = new AutopilotService({
      channels: eligibleChannels(),
      publications,
      scheduler,
    });
    const config = await service.updateConfig({
      enabled: true,
      mode: "AUTOPILOT",
      platforms: ["TIKTOK"],
      approvalRequired: false,
    });

    await saveProject(root, readyProject());
    const result = await service.advanceProject(PROJECT_ID, { config });

    assert.equal(result.state, "PUBLICATIONS_SCHEDULED");
    assert.deepEqual(result.publicationIds, [PUBLICATION_ID]);
    assert.equal(scheduleCalls, 1);
  });
});
