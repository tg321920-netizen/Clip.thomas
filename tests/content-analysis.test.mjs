import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TranscriptCandidateProvider } from "../services/analysis/TranscriptCandidateProvider.mjs";
import { analyzeProject } from "../services/analysis/ContentAnalysisService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

const segments = Array.from({ length: 14 }, (_, index) => ({
  id: `segment-${index + 1}`,
  startTime: index * 6,
  endTime: index * 6 + 5.5,
  text:
    index % 4 === 0
      ? "¿Sabías por qué pasó esto? De repente encontramos una respuesta increíble."
      : index % 4 === 1
        ? "La explicación tiene un detalle importante y cambia la manera de entender el problema."
        : index % 4 === 2
          ? "Pero después apareció otro dato que nadie esperaba y tuvimos que comparar los resultados."
          : "Finalmente la idea queda clara y se puede entender sin depender de la conversación anterior.",
}));

test("candidate provider creates bounded, sorted, explainable candidates", async () => {
  const provider = new TranscriptCandidateProvider({
    minDuration: 15,
    maxDuration: 60,
    targetDuration: 30,
    maxCandidates: 6,
  });

  const candidates = await provider.analyze({
    transcript: { segments },
  });

  assert.ok(candidates.length > 0 && candidates.length <= 6);

  for (const candidate of candidates) {
    assert.ok(candidate.duration >= 15 && candidate.duration <= 60);
    assert.ok(candidate.viralScore >= 0 && candidate.viralScore <= 100);
    assert.ok(candidate.startTime < candidate.endTime);
    assert.ok(candidate.title.length > 0);
    assert.ok(candidate.hook.length > 0);
    assert.ok(candidate.reasons.length > 0);
    assert.equal(candidate.components.audioEnergy, null);
  }

  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(
      candidates[index - 1].viralScore >= candidates[index].viralScore,
    );
  }
});

test("content analysis persists candidates and reuses current results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analysis-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const projectsDir = path.join(root, "projects");
    await mkdir(projectsDir, { recursive: true });

    const project = {
      id: PROJECT_ID,
      createdAt: new Date().toISOString(),
      source: {
        projectId: PROJECT_ID,
        videoId: "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b",
        originalName: "analysis.mp4",
        storedName: "source.mp4",
        sizeBytes: 1000,
        durationSeconds: 84,
        relativePath: `uploads/${PROJECT_ID}/source.mp4`,
      },
      transcript: {
        id: "transcript-1",
        projectId: PROJECT_ID,
        videoId: "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b",
        status: "COMPLETED",
        provider: "whisper-cli",
        model: "tiny",
        language: "es",
        text: segments.map((segment) => segment.text).join(" "),
        segments,
        sourceKey: "source.mp4:1000:84",
        audioRelativePath: `transcripts/${PROJECT_ID}/audio.wav`,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: "2026-09-21T00:00:00.000Z",
        error: null,
      },
    };

    const target = path.join(projectsDir, `${PROJECT_ID}.json`);
    await writeFile(target, JSON.stringify(project, null, 2), "utf8");

    const first = await analyzeProject(PROJECT_ID, {
      maxCandidates: 5,
    });

    assert.equal(first.reused, false);
    assert.equal(first.analysis.status, "COMPLETED");
    assert.ok(first.analysis.candidates.length > 0);

    const second = await analyzeProject(PROJECT_ID, {
      provider: {
        name: "must-not-run",
        async analyze() {
          throw new Error("Current analysis should have been reused.");
        },
      },
    });

    assert.equal(second.reused, true);

    const stored = JSON.parse(await readFile(target, "utf8"));
    assert.equal(stored.analysis.status, "COMPLETED");
    assert.ok(stored.analysis.candidates.length > 0);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;

    await rm(root, { recursive: true, force: true });
  }
});
