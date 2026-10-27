import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { replaceProjectFile } from "../lib/project-files.mjs";
import { loadProjectFile } from '../lib/project-files.mjs';
import {
  buildChunkPlan,
  transcribeProject,
} from "../services/transcription/TranscriptionService.mjs";

test("long transcription is chunked, keeps real timestamps and resumes after a partial failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-long-transcription-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  const projectId = randomUUID();
  const extractionCount = new Map();
  let failSecondChunkOnce = true;

  const provider = {
    name: "fake-whisper",
    model: "fake-model",
    async transcribe(audioPath) {
      const name = path.basename(audioPath);
      if (name === "chunk-0001.wav" && failSecondChunkOnce) {
        failSecondChunkOnce = false;
        throw new Error("synthetic chunk failure");
      }
      return {
        provider: "fake-whisper",
        model: "fake-model",
        language: "es",
        text: `texto ${name}`,
        durationSeconds: 5,
        segments: [
          {
            id: "local-segment",
            startTime: 0,
            endTime: 5,
            text: `texto ${name}`,
            words: [
              { startTime: 1, endTime: 2, text: "texto" },
            ],
          },
        ],
      };
    },
  };

  const audioExtractor = async (_source, audioPath, options) => {
    const name = path.basename(audioPath);
    extractionCount.set(name, (extractionCount.get(name) || 0) + 1);
    assert.ok(options.duration > 0);
  };

  try {
    await replaceProjectFile(projectId, {
      id: projectId,
      createdAt: new Date().toISOString(),
      source: {
        projectId,
        videoId: randomUUID(),
        originalName: "long.mp4",
        storedName: "source.mp4",
        relativePath: `uploads/${projectId}/source.mp4`,
        sizeBytes: 123456,
        durationSeconds: 150,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: "h264",
        container: "mp4",
        aspectRatio: "16:9",
        posterUrl: `/api/projects/${projectId}/poster`,
        sourceUrl: `/api/projects/${projectId}/source`,
      },
    });

    assert.deepEqual(
      buildChunkPlan(150, 60).map(({ startTime, endTime }) => [startTime, endTime]),
      [[0, 60], [60, 120], [120, 150]],
    );

    await assert.rejects(
      () =>
        transcribeProject(projectId, {
          provider,
          audioExtractor,
          chunkDurationSeconds: 60,
        }),
      /synthetic chunk failure/,
    );

    const result = await transcribeProject(projectId, {
      provider,
      audioExtractor,
      chunkDurationSeconds: 60,
    });

    assert.equal(result.transcript.status, "COMPLETED");
    assert.equal(result.transcript.progress, 100);
    assert.equal(result.transcript.chunks.length, 3);
    assert.ok(result.transcript.chunks.every((chunk) => chunk.status === "COMPLETED"));
    assert.deepEqual(
      result.transcript.segments.map((segment) => segment.startTime),
      [0, 60, 120],
    );
    assert.deepEqual(
      result.transcript.segments.map((segment) => segment.words?.[0]?.startTime),
      [1, 61, 121],
    );
    assert.equal(extractionCount.get("chunk-0000.wav"), 1);
    assert.equal(extractionCount.get("chunk-0001.wav"), 2);
    assert.equal(extractionCount.get("chunk-0002.wav"), 1);
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    await rm(root, { recursive: true, force: true });
  }
});

test('a changed model or language starts a new transcript instead of mixing completed old chunks',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-transcription-settings-'));const previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  const id=randomUUID();await replaceProjectFile(id,{id,source:{storedName:'source.mp3',relativePath:`uploads/${id}/source.mp3`,durationSeconds:130,sizeBytes:1234}});
  let calls=0;const provider={name:'UNIT_MOCK_ONLY',model:'first',language:'en',transcribe:async()=>{calls++;return{language:'en',segments:[{startTime:0,endTime:3,text:'A complete sentence.'}]};}};
  const options={provider,audioExtractor:async()=>{},chunkDurationSeconds:60};
  const first=await transcribeProject(id,options);assert.equal(calls,3);
  assert.equal((await transcribeProject(id,options)).reused,true);assert.equal(calls,3);
  provider.model='second';const second=await transcribeProject(id,options);assert.equal(calls,6);assert.notEqual(second.transcript.id,first.transcript.id);
  provider.language='es';await transcribeProject(id,options);assert.equal(calls,9);
  assert.equal((await loadProjectFile(id)).transcript.chunks.length,3);
});
