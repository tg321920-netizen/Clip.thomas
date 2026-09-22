import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HeuristicAutoEditProvider } from "../services/autoedit/HeuristicAutoEditProvider.mjs";
import {
  normalizeAutoEditPlan,
  prepareAutoEdit,
} from "../services/autoedit/AutoEditService.mjs";
import { JobStore } from "../services/JobStore.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const VIDEO_ID = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";

const candidates = [
  {
    id: "candidate-0001",
    startTime: 0,
    endTime: 24,
    duration: 24,
    title: "Primer candidato",
    hook: "Un inicio normal",
    text: "Este fragmento tiene información útil pero menos fuerza.",
    reason: "Contexto suficiente.",
    viralScore: 48,
    reasons: ["Contexto suficiente."],
  },
  {
    id: "candidate-0002",
    startTime: 24,
    endTime: 54,
    duration: 30,
    title: "El dato inesperado",
    hook: "¿Por qué nadie esperaba este resultado?",
    text: "¿Por qué nadie esperaba este resultado? El dato cambió por completo la explicación y sorprendió a todos.",
    reason: "Hook fuerte y sorpresa.",
    viralScore: 82,
    reasons: ["Hook fuerte.", "Sorpresa."],
  },
];

const transcript = {
  id: "transcript-1",
  projectId: PROJECT_ID,
  videoId: VIDEO_ID,
  status: "COMPLETED",
  provider: "whisper-cli",
  model: "tiny",
  language: "es",
  text: candidates.map((candidate) => candidate.text).join(" "),
  segments: [
    {
      id: "segment-1",
      startTime: 24,
      endTime: 30,
      text: "¿Por qué nadie esperaba este resultado?",
      words: [
        { startTime: 24, endTime: 24.5, text: "¿Por" },
        { startTime: 24.5, endTime: 25, text: "qué" },
        { startTime: 25, endTime: 25.5, text: "nadie" },
        { startTime: 25.5, endTime: 26, text: "esperaba" },
        { startTime: 26, endTime: 26.5, text: "este" },
        { startTime: 26.5, endTime: 27.2, text: "resultado?" },
      ],
    },
    {
      id: "segment-2",
      startTime: 30,
      endTime: 54,
      text: "El dato cambió por completo la explicación y sorprendió a todos.",
    },
  ],
  sourceKey: "source",
  audioRelativePath: "transcripts/test/audio.wav",
  createdAt: "2026-09-22T00:00:00.000Z",
  startedAt: "2026-09-22T00:00:00.000Z",
  completedAt: "2026-09-22T00:01:00.000Z",
  error: null,
};

test("heuristic Auto Edit selects the strongest candidate and prepares metadata", async () => {
  const provider = new HeuristicAutoEditProvider();
  const plan = await provider.prepare({
    candidates,
    transcript,
    options: {},
  });

  assert.equal(plan.candidateId, "candidate-0002");
  assert.equal(plan.subtitleStyle, "KARAOKE");
  assert.deepEqual(plan.recommendedPlatforms, [
    "TIKTOK",
    "YOUTUBE",
    "FACEBOOK",
  ]);
  assert.ok(plan.hashtags.length > 0);
  assert.ok(plan.onScreenText.length > 0);
});

test("Auto Edit plan never accepts timing outside the selected candidate", () => {
  const project = {
    analysis: { candidates },
  };

  const plan = normalizeAutoEditPlan(
    {
      candidateId: "candidate-0002",
      startTime: -100,
      endTime: 999,
      title: "Título",
      hook: "Hook",
      description: "Descripción",
      hashtags: ["#prueba"],
      onScreenText: "Texto",
      recommendedPlatforms: ["TIKTOK"],
      subtitleStyle: "VIRAL",
      framingMode: "FILL",
      quality: "BALANCED",
      reason: "Prueba",
    },
    project,
    {
      providerName: "mock",
      providerModel: null,
      sourceKey: "key",
    },
  );

  assert.equal(plan.startTime, 24);
  assert.equal(plan.endTime, 54);
  assert.equal(plan.duration, 30);
});

test("Auto Edit persists one reusable clip and generated subtitles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autoedit-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  let calls = 0;
  const provider = {
    name: "mock-autoedit",
    model: null,
    async prepare() {
      calls += 1;
      return {
        candidateId: "candidate-0002",
        startTime: 24,
        endTime: 54,
        title: "El dato inesperado",
        hook: "¿Por qué nadie esperaba este resultado?",
        description: candidates[1].text,
        hashtags: ["#resultado", "#explicacion"],
        onScreenText: "Nadie esperaba este resultado",
        recommendedPlatforms: ["TIKTOK", "YOUTUBE", "FACEBOOK"],
        subtitleStyle: "KARAOKE",
        framingMode: "FILL",
        quality: "BALANCED",
        reason: "Hook fuerte y contexto suficiente.",
      };
    },
  };

  try {
    const projectsDir = path.join(root, "projects");
    await mkdir(projectsDir, { recursive: true });

    const project = {
      id: PROJECT_ID,
      createdAt: "2026-09-22T00:00:00.000Z",
      source: {
        projectId: PROJECT_ID,
        videoId: VIDEO_ID,
        originalName: "source.mp4",
        storedName: "source.mp4",
        sizeBytes: 1000,
        durationSeconds: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        container: "mp4",
        aspectRatio: "16:9",
        posterUrl: "",
        sourceUrl: "",
        relativePath: `uploads/${PROJECT_ID}/source.mp4`,
      },
      transcript,
      analysis: {
        id: "analysis-1",
        projectId: PROJECT_ID,
        status: "COMPLETED",
        provider: "transcript-heuristic-v1",
        sourceKey: "analysis-source",
        config: {
          minDuration: 15,
          maxDuration: 60,
          targetDuration: 30,
          maxCandidates: 10,
        },
        candidates,
        createdAt: "2026-09-22T00:02:00.000Z",
        startedAt: "2026-09-22T00:02:00.000Z",
        completedAt: "2026-09-22T00:03:00.000Z",
        error: null,
      },
    };

    await writeFile(
      path.join(projectsDir, `${PROJECT_ID}.json`),
      JSON.stringify(project, null, 2),
      "utf8",
    );

    const first = await prepareAutoEdit(PROJECT_ID, { provider });
    assert.equal(first.reused, false);
    assert.equal(first.clip.candidateId, "candidate-0002");
    assert.equal(first.clip.autoEdit.provider, "mock-autoedit");
    assert.equal(first.clip.subtitles.style, "KARAOKE");
    assert.equal(first.clip.status, "DRAFT");

    const second = await prepareAutoEdit(PROJECT_ID, { provider });
    assert.equal(second.reused, true);
    assert.equal(second.clip.id, first.clip.id);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("AUTO_EDIT jobs remain isolated from other project jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autoedit-jobs-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const store = new JobStore();
    await store.enqueueAnalysis(PROJECT_ID);
    const autoEdit = await store.enqueueAutoEdit(PROJECT_ID, {
      generateSubtitles: true,
    });

    const claimed = await store.claimNext(["AUTO_EDIT"]);
    assert.equal(claimed?.id, autoEdit.id);
    assert.equal(claimed?.type, "AUTO_EDIT");

    await store.complete(claimed);

    const analysis = await store.getAnalysisJob(PROJECT_ID);
    assert.equal(analysis?.status, "QUEUED");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
