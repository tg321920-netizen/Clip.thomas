import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  statfs,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { JobStore } from "../JobStore.mjs";
import { MAX_UPLOAD_BYTES } from "../../lib/upload-policy.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { hashFile } from "./ResumableUploadStore.mjs";
import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";
import { openHlsInput, HlsInputError } from "./HlsInputService.mjs";
import { isKickSource, resolveKickSource } from "../live/KickPublicSourceService.mjs";
import { openKickChat } from "../live/KickChatSource.mjs";
import { LiveObservationStore, alignChatToCapture, sameLiveSource } from "../live/LiveObservationStore.mjs";

export async function ingestUrlJob(job, options = {}) {
  const projectId = job.projectId || job.id;
  const mode = String(job?.source?.mode || "IMPORT").toUpperCase();
  const sourceUrl = mode === "UPLOAD" ? null : await parsePublicSourceUrl(job?.source?.url);
  const existing = mode === "UPLOAD" ? await loadProjectFile(projectId) : null;
  if (existing?.source && existing.ingest?.jobId === job.id) return { projectId, video: existing.source };
  const root = getStorageRoot();
  const uploadDir = path.join(root, "uploads", projectId);
  const posterPath = path.join(uploadDir, "poster.jpg");
  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : async () => {};

  await mkdir(uploadDir, { recursive: true });
  await onProgress(2, "VALIDATING");

  let mediaPath;
  let kickSource = null, captureInfo = null, chat = null, chatState = null, observationReceipt = null, savedObservations = { bins: [], recordIds: [] };
  const observations = new LiveObservationStore();
  const sourceResolved = async source => {
    kickSource = source;
    savedObservations = await observations.loadForSource(source);
    if (source.sourceKind === "LIVE" && !source.recoveredCapture && job.source.captureChat !== false) {
      try { chat = await openKickChat({ channelId: source.channelId, chatroomId: source.chatroomId, signal: options.signal }); }
      catch (error) { chatState = { status: "UNAVAILABLE", errorCode: error.code || "CHAT_UNAVAILABLE", acceptedMessages: 0 }; }
    }
  };
  const bins = () => [...savedObservations.bins, ...(chat?.snapshot().bins || [])];
  if (mode === "UPLOAD") {
    mediaPath = resolveStoragePath(job.source.relativePath);
    const info = await stat(mediaPath);
    if (info.size !== job.source.size || await hashFile(mediaPath) !== job.source.sha256) {
      throw new Error("El archivo guardado no supera la comprobación de integridad.");
    }
  } else if (mode === "STREAM") {
    try { mediaPath = await captureSegmentedStream({
      url: sourceUrl.toString(),
      uploadDir,
      captureSeconds: Number(job.source.captureSeconds || 30),
      segmentSeconds: Number(job.source.segmentSeconds || 300),
      onProgress: (progress, stage) => onProgress(progress, stage, { chatStatus: chat?.snapshot().status || chatState?.status || "WAITING_SOURCE", acceptedMessages: chat?.snapshot().acceptedMessages || 0 }),
      signal: options.signal,
      startTimeSeconds: Number(job.source.startTimeSeconds || 0),
      onSourceResolved: sourceResolved,
      onCaptureMetadata: async metadata => { captureInfo = metadata; },
      onSegment: job.source.autoClip && job.source.clipMode !== "CAPTURE" ? async (file, index, context) => {
        const windows = context.sourceStartUtc ? alignChatToCapture(bins(), { sourceRanges: [{ offsetSeconds: 0, sourceStartUtc: context.sourceStartUtc }] }, context.durationSeconds) : [];
        await queueCapturedSegment({ file, index, job, signal: options.signal,
          liveObservation: kickSource ? { channel: kickSource.channel, source: kickSource, chatActivityWindows: windows,
            chatStatus: chat?.snapshot().status || chatState?.status || "NO_SAVED_OBSERVATIONS", sourceStartUtc: context.sourceStartUtc } : null });
      } : undefined,
    }); } finally {
      if (chat) {
        const snapshot = chat.snapshot(); chatState = { status: snapshot.status, acceptedMessages: snapshot.acceptedMessages, errorCode: snapshot.error };
        try { observationReceipt = await observations.save({ id: job.id, source: kickSource, bins: snapshot.bins, chatStatus: snapshot.status,
          captureStatus: mediaPath ? "CAPTURED_UNVERIFIED" : "FAILED" }, { archive: true }); } catch { /* Captured media remains recoverable. */ }
        chat.close();
      }
    }
  } else if (mode === "IMPORT") {
    mediaPath = await importRemoteVideo({
      url: sourceUrl.toString(),
      uploadDir,
      onProgress,
      signal: options.signal,
    });
  } else {
    throw new Error(`Unsupported ingest mode: ${mode}.`);
  }

  const fileStats = await stat(mediaPath);
  if (!fileStats.isFile() || fileStats.size <= 0) {
    throw new Error("La fuente terminó sin generar un archivo de video válido.");
  }
  if (fileStats.size > MAX_UPLOAD_BYTES) {
    throw new Error("El video supera el límite actual de 1 GB.");
  }

  await onProgress(94, "PROBING");
  const technical = await probeMedia(mediaPath, { signal: options.signal });
  if (mode === "STREAM") {
    if (kickSource && !technical.hasAudio) throw new Error("La captura de Kick no contiene la pista de audio original.");
    await runProcess(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-threads", "1", "-xerror", "-i", mediaPath, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"],
      { signal: options.signal, timeoutMs: (technical.durationSeconds + 180) * 1000 });
  }
  if (technical.mediaKind !== 'AUDIO') await createPoster(
    mediaPath,
    posterPath,
    Math.min(1, technical.durationSeconds / 2),
    { signal: options.signal },
  );

  const storedName = path.basename(mediaPath);
  const videoId = randomUUID();
  const video = {
    projectId,
    videoId,
    originalName: mode === "UPLOAD" ? job.source.filename : makeOriginalName(sourceUrl, storedName, mode),
    storedName,
    sizeBytes: fileStats.size,
    posterUrl: technical.mediaKind === 'AUDIO' ? '' : `/api/projects/${projectId}/poster`,
    sourceUrl: `/api/projects/${projectId}/source`,
    ...(sourceUrl ? { originUrl: redactUrlForMetadata(sourceUrl) } : {}),
    ingestMode: mode,
    ...technical,
    ...(mode === "STREAM" ? { captureValidation: { valid: true, fullDecode: true }, capture: { requestedDurationSeconds: job.source.captureSeconds,
      actualDurationSeconds: technical.durationSeconds, requestedStartSeconds:job.source.startTimeSeconds, vodStartSeconds:captureInfo?.vodStartSeconds ?? null, sourceRanges: captureInfo?.sourceRanges || [], continuityBreaks: captureInfo?.continuityBreaks || [] } } : {}),
  };

  await onProgress(98, "FINALIZING");
  await replaceProjectFile(projectId, {
    id: projectId,
    createdAt: new Date().toISOString(),
    source: {
      ...video,
      relativePath: path.posix.join("uploads", projectId, storedName),
    },
    ingest: {
      jobId: job.id,
      mode,
      sourceHost: sourceUrl?.hostname || null,
      sha256: job.source.sha256 || null,
      completedAt: new Date().toISOString(),
    },
    ...(kickSource ? { liveObservation: { channel: kickSource.channel, source: kickSource,
      chatActivityWindows: alignChatToCapture(bins(), captureInfo, technical.durationSeconds),
      chatStatus: chatState?.status || (savedObservations.bins.length ? "SAVED_OBSERVATIONS" : "UNAVAILABLE"),
      acceptedMessages: chatState?.acceptedMessages || 0, savedObservationIds: savedObservations.recordIds, captureType: kickSource.sourceKind,
      observationStorage: observationReceipt ? { cloudSaved: observationReceipt.cloudSaved, error: observationReceipt.cloudError } : null,
      observationRecoveryError: savedObservations.cloudError || null,
      clockUncertaintySeconds: 10 } } : {}),
  });

  let clipsJob = null;
  if (mode === "STREAM" && job.source.autoClip && job.source.clipMode === "CAPTURE") {
    options.signal?.throwIfAborted();
    clipsJob = await queueCapturedBatch({ projectId, job });
  }
  await cleanupIngestArtifacts(uploadDir, storedName, { preserveSegments: mode === "STREAM" });
  await onProgress(100, "COMPLETED");
  return { projectId, video, ...(clipsJob ? { clipsJobId: clipsJob.id, requestedClipCount: clipsJob.payload.count } : {}) };
}

export async function importRemoteVideo({ url, uploadDir, onProgress = async () => {}, signal }) {
  await mkdir(uploadDir, { recursive: true });
  if (isKickSource(url)) {
    const input = await resolveKickSource(url, { signal });
    if (input.metadata.sourceKind !== "VOD") throw new Error("Usa Capturar directo para grabar un tramo del canal que está transmitiendo.");
    if (!input.metadata.durationSeconds || input.metadata.durationSeconds > 86400) throw new Error("No se confirmó una duración importable de la grabación.");
    return captureSegmentedStream({ url: input.url, inputFormat: "HLS", isVodSource: true, uploadDir,
      captureSeconds: input.metadata.durationSeconds, segmentSeconds: 60, signal, onProgress });
  }
  const ytdlp = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const template = path.join(uploadDir, "source.%(ext)s");

  // Direct media links are not web pages. Stream them through FFmpeg instead
  // of depending on a provider-specific yt-dlp extractor.
  if (isDirectMediaUrl(url)) {
    await onProgress(8, "DOWNLOADING");
    try {
      await downloadDirectWithFfmpeg(url, path.join(uploadDir, "source.mp4"), signal);
    } catch (error) {
      throw new Error(`No se pudo importar el enlace multimedia directo. ${compactError(error)}`);
    }
    const direct = await findDownloadedMedia(uploadDir);
    if (!direct) throw new Error("La URL directa no produjo un archivo de video válido.");
    await onProgress(90, "DOWNLOADED");
    return direct;
  }

  try {
    await runProcess(
      ytdlp,
      [
        "--no-playlist",
        ...providerYtDlpArgs(url),
        "--continue",
        "--newline",
        "--no-warnings",
        "--max-filesize",
        "1000M",
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--progress-template",
        "download:%(progress._percent_str)s",
        "-o",
        template,
        url,
      ],
      {
        signal,
        timeoutMs: normalizeTimeout(process.env.CLIPFORGE_URL_IMPORT_TIMEOUT_MS, 6 * 60 * 60 * 1000),
        onStdoutLine(line) {
          const match = /^download:\s*([0-9.]+)%/.exec(line.trim());
          if (match) {
            const percent = Number(match[1]);
            if (Number.isFinite(percent)) {
              void onProgress(Math.max(4, Math.min(88, Math.round(4 + percent * 0.84))), "DOWNLOADING");
            }
          }
        },
      },
    );
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") {
      if (/sign in to confirm|not a bot|confirm you(?:'|’)re not a bot/i.test(compactError(error))) {
        throw new Error("YouTube bloqueó la importación porque exige una verificación de acceso. ClipForge no puede completarla automáticamente. Sube un archivo propio o autorizado usando Subir video.");
      }
      throw new Error(
        formatRemoteImportFailure(url, error),
      );
    }

    // A direct MP4/HLS URL can still work without yt-dlp. Normal web pages
    // cannot be resolved by FFmpeg and return an explicit error below.
    await onProgress(8, "DOWNLOADING");
    try {
      await downloadDirectWithFfmpeg(url, path.join(uploadDir, "source.mp4"), signal);
    } catch (fallbackError) {
      throw new Error(
        "yt-dlp no está disponible en el runtime y FFmpeg tampoco pudo leer la URL como video directo. " +
          compactError(fallbackError),
      );
    }
  }

  const mediaPath = await findDownloadedMedia(uploadDir);
  if (!mediaPath) {
    throw new Error("La URL terminó sin producir un archivo multimedia compatible.");
  }

  await onProgress(90, "DOWNLOADED");
  return mediaPath;
}

export async function captureSegmentedStream({
  url,
  uploadDir,
  captureSeconds,
  segmentSeconds = 300,
  signal,
  onSegment,
  onProgress = async () => {},
  startTimeSeconds = 0,
  inputFormat,
  onDiagnostic,
  onCaptureMetadata = async () => {},
  hlsInputFactory = openHlsInput,
  kickSourceResolver = resolveKickSource,
  isVodSource = false,
  onSourceResolved = async () => {},
  finalize = true,
  deliverOnInterruption = false,
  maxCaptureBytes = MAX_UPLOAD_BYTES,
  checkCapacity = async () => {},
  resumeSourceUtc = null,
  startNumberFloor = 0,
}) {
  if (!Number.isFinite(startTimeSeconds) || startTimeSeconds < 0 || startTimeSeconds > 86400) throw new Error("El comienzo de la captura no es válido.");
  const totalSeconds = Math.max(5, Math.min(24 * 60 * 60, Math.round(Number(captureSeconds) || 30)));
  const chunkSeconds = Math.max(30, Math.min(15 * 60, Math.round(Number(segmentSeconds) || 300)));
  const partsDir = path.join(uploadDir, ".stream-parts");
  await mkdir(partsDir, { recursive: true });
  const sourceFingerprint = createHash("sha256").update(url).digest("hex");
  const clockFile = path.join(partsDir, "capture-clock.json");
  let clock = { version: 1, sourceFingerprint, source: null, ranges: [], continuityBreaks: [] };
  try {
    const saved = JSON.parse(await readFile(clockFile, "utf8"));
    if (saved.version === 1 && saved.sourceFingerprint === sourceFingerprint && Array.isArray(saved.ranges)) {
      clock = { ...saved, ranges: saved.ranges.filter(r => Number.isFinite(r.offsetSeconds) && Number.isFinite(Date.parse(r.sourceStartUtc))),
        continuityBreaks: (saved.continuityBreaks || []).filter(Number.isFinite) };
    }
  } catch { /* Missing/damaged clock is unknown, never invented. */ }
  let activeInput = null, activeRange = null, metadataNotified = false;
  const clockSnapshot = () => ({ ...(activeInput?.snapshot() || {}), source: clock.source, sourceRanges: clock.ranges,
    continuityBreaks: clock.continuityBreaks, vodStartSeconds: Number.isFinite(clock.vodBaseSeconds)?clock.vodBaseSeconds:null, startTimeSeconds, resumedSeconds: approximateCaptured });
  async function persistClock() {
    const temp = `${clockFile}.tmp`; await writeFile(temp, JSON.stringify(clock)); await rename(temp, clockFile);
  }
  async function ensureClock() {
    const snapshot = activeInput?.snapshot();
    const sourceStartUtc = snapshot?.firstServedProgramUtc;
    if (sourceStartUtc && !activeRange) {
      activeRange = { offsetSeconds: approximateCaptured, sourceStartUtc };
      if (approximateCaptured === 0 && Number.isFinite(snapshot.windowStartSeconds)) clock.vodBaseSeconds = snapshot.windowStartSeconds + (Number.isFinite(Date.parse(snapshot.firstServedProgramUtc)) && Number.isFinite(Date.parse(snapshot.windowStartUtc)) ? Math.max(0,(Date.parse(snapshot.firstServedProgramUtc)-Date.parse(snapshot.windowStartUtc))/1000) : 0);
      const previous = clock.ranges.at(-1);
      if (approximateCaptured > 0 && (!previous || Math.abs(Date.parse(previous.sourceStartUtc) + (approximateCaptured - previous.offsetSeconds) * 1000 - Date.parse(sourceStartUtc)) > 2000)) {
        clock.continuityBreaks = [...new Set([...clock.continuityBreaks, approximateCaptured])];
      }
      clock.ranges = [...clock.ranges.filter(r => r.offsetSeconds < approximateCaptured), activeRange];
      await persistClock();
    }
    if (sourceStartUtc && !metadataNotified) { metadataNotified = true; await onCaptureMetadata(clockSnapshot()); }
  }

  // Older releases wrote ordinary MP4 fragments. If FFmpeg was killed while
  // transcoding on a small instance, those files had no final moov atom and a
  // retry would keep selecting the corrupt fragment forever. MPEG-TS is both
  // cheap to stream-copy and remains readable when a capture is interrupted.
  await preserveLegacyMp4StreamParts(partsDir);


  const existing = await listStreamParts(partsDir);
  // Probe completed data, never infer duration from the number of files. A
  // killed recorder can leave a readable but short transport-stream segment.
  let capturedSeconds = 0;
  for (const name of existing) {
    signal?.throwIfAborted();
    try {
      const technical = await probeMedia(path.join(partsDir, name), { signal });
      await runProcess(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-threads", "1", "-xerror", "-i", path.join(partsDir, name), "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"],
        { signal, timeoutMs: (technical.durationSeconds + 180) * 1000 });
      capturedSeconds += technical.durationSeconds;
    } catch (error) {
      // Cancellation, unavailable tools and worker/host failures do not prove
      // that preserved media is corrupt. Keep its identity for a later retry.
      signal?.throwIfAborted();
      if (["ENOENT", "EACCES", "EPERM", "EAGAIN", "ENOMEM", "EMFILE", "ENFILE", "ENOSPC",
        "INGEST_PROCESS_TIMEOUT", "INGEST_PROCESS_INTERRUPTED", "INGEST_PROBE_INVALID_RESPONSE"].includes(getErrorCode(error))) throw error;
      // Retain damaged recorder output for diagnosis, but never merge it.
      await rename(path.join(partsDir, name), path.join(partsDir, `${name}.invalid-${Date.now()}`));
    }
  }
  const approximateCaptured = Math.min(totalSeconds, capturedSeconds);
  const remaining = Math.max(0, totalSeconds - approximateCaptured);
  if (!remaining && clock.source) await onSourceResolved({ ...clock.source, recoveredCapture: true });

  const delivered = new Set();
  let delivery = Promise.resolve();
  function deliverParts(final = false, interrupted = false) {
    if (!onSegment) return Promise.resolve();
    delivery = delivery.then(async () => {
    const parts = await listStreamParts(partsDir);
    let offsetSeconds = 0;
    for (const name of final ? parts : parts.slice(0, -1)) {
      const technical = await probeMedia(path.join(partsDir, name), { signal: interrupted ? undefined : signal });
      const partOffset = offsetSeconds; offsetSeconds += technical.durationSeconds;
      if (delivered.has(name)) continue;
      if (!interrupted) signal?.throwIfAborted();
      const range = [...clock.ranges].reverse().find(r => r.offsetSeconds <= partOffset);
      await onSegment(path.join(partsDir, name), Number(name.match(/(\d+)\.ts$/)[1]), {
        offsetSeconds: partOffset, durationSeconds: technical.durationSeconds,
        sourceStartUtc: range ? new Date(Date.parse(range.sourceStartUtc) + (partOffset - range.offsetSeconds) * 1000).toISOString() : null,
      });
      delivered.add(name);
    }
    });
    return delivery;
  }
  await deliverParts(true);
  if (remaining > 0) {
    await onProgress(3, "RESOLVING_MEDIA");
    const kickInput = isKickSource(url) ? await kickSourceResolver(url, { signal }) : null;
    if (kickInput) {
      if (capturedSeconds > 0 && !clock.source) throw Object.assign(new Error("La captura parcial no conserva la identidad de sesión. Recupera su checkpoint o inicia otro trabajo; los segmentos se conservan."), { code: "LIVE_SOURCE_IDENTITY_UNKNOWN", stage: "SOURCE_IDENTITY" });
      if (clock.source && !sameLiveSource(clock.source, kickInput.metadata)) throw Object.assign(new Error("Cambió la transmisión de Kick. Inicia otra captura; no se mezclan sus bytes con los segmentos anteriores."), { code: "LIVE_SOURCE_CHANGED", stage: "SOURCE_IDENTITY" });
      clock.source = kickInput.metadata; await onSourceResolved(kickInput.metadata);
    }
    const resolvedUrl = kickInput?.url || (path.isAbsolute(url) || inputFormat === "HLS" || isDirectStreamInputUrl(url) ? url : await resolveStreamUrl(url, { signal }));
    const remote = /^https?:\/\//iu.test(resolvedUrl);
    const hls = remote && (inputFormat === "HLS" || kickInput || /\.m3u8(?:[?#]|$)/iu.test(resolvedUrl) || !isDirectStreamInputUrl(url));
    const vodOffset = (clock.vodBaseSeconds ?? startTimeSeconds) + (startTimeSeconds > 0 || isVodSource || kickInput?.metadata.sourceKind === "VOD" ? capturedSeconds : 0);
    // An interrupted stream-copy part can end inside an upstream HLS segment.
    // Preserve its verified bytes and resume at the next source segment rather
    // than download/append the already captured opening again. The UTC journal
    // records the resulting gap; candidates may not cross it.
    const input = hls ? await hlsInputFactory(resolvedUrl, { signal, onDiagnostic, vodStartSeconds: vodOffset, windowSeconds: remaining, resumeAtNextSegment: capturedSeconds > 0, resumeSourceUtc }) : null;
    activeInput = input;
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const outputPattern = path.join(partsDir, "part-%06d.ts");
    const args = buildStreamCaptureArgs({
      resolvedUrl: input?.inputUrl || resolvedUrl,
      liveStartAtFirstSegment: Boolean(input),
      remaining,
      chunkSeconds,
      startNumber: Math.max(startNumberFloor, existing.length ? Number(existing.at(-1).match(/(\d+)\.ts$/)[1]) + 1 : 0),
      seekSeconds: input ? 0 : startTimeSeconds + (isSeekableCaptureInput(url) ? capturedSeconds : 0),
      outputPattern,
    });

    try { await runProcess(ffmpeg, args, {
      signal,
      async checkResources() {
        await checkCapacity();
        await ensureClock();
        await deliverParts();
        const names = await readdir(partsDir);
        const sizes = await Promise.all(names.map(async name => (await stat(path.join(partsDir, name))).size));
        if (sizes.reduce((sum, size) => sum + size, 0) >= maxCaptureBytes) throw Object.assign(new Error("La captura alcanzó el límite de almacenamiento. Los originales se conservan."), { code: "LIVE_STORAGE_LIMIT" });
        const space = await statfs(uploadDir);
        if (space.bavail * space.bsize < 128 * 1024 * 1024) throw new Error("Espacio libre insuficiente para continuar la captura y finalizar el MP4.");
      },
      timeoutMs: (remaining + 180) * 1000,
      onStdoutLine(line) {
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        if (!match) return;
        const seconds = Number(match[1]) / 1_000_000;
        if (!Number.isFinite(seconds)) return;
        const totalProgressSeconds = approximateCaptured + seconds;
        const percent = 4 + (totalProgressSeconds / totalSeconds) * 84;
        void onProgress(Math.max(4, Math.min(88, Math.round(percent))), "CAPTURING_STREAM");
      },
    });
      if (input) { await ensureClock(); await onCaptureMetadata(clockSnapshot()); await persistClock(); }
    } catch (error) {
      if (deliverOnInterruption) { await ensureClock(); await onCaptureMetadata(clockSnapshot()); await persistClock(); await deliverParts(true, true); }
      signal?.throwIfAborted();
      const failure = input?.snapshot().lastError;
      if (failure) throw new HlsInputError(failure.stage, failure.status, failure.code);
      error.code ||= "FFMPEG_CAPTURE_FAILED"; error.stage ||= "MEDIA_READ";
      throw error;
    } finally { await input?.close(); }
  }

  if (!remaining && clock.ranges.length) await onCaptureMetadata(clockSnapshot());

  await deliverParts(true);
  const parts = await listStreamParts(partsDir);
  if (parts.length === 0) {
    throw new Error("FFmpeg no pudo obtener ningún segmento del stream.");
  }

  if (!finalize) return { partsDir, parts, capture: clockSnapshot() };

  await onProgress(90, "MERGING_SEGMENTS");
  const concatPath = path.join(partsDir, "concat.txt");
  await writeFile(
    concatPath,
    parts.map((name) => `file '${name}'`).join("\n") + "\n",
    "utf8",
  );

  const output = path.join(uploadDir, "source.mp4");
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-movflags",
      "+faststart",
      output,
    ],
    { signal, cwd: partsDir, timeoutMs: 30 * 60 * 1000 },
  );

  return output;
}

/** One count for the whole captured source, independent of its segment count. */
export async function queueCapturedBatch({ projectId, job }) {
  const count = Number(job.source.clipCount ?? 5);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) throw new Error("Elige una cantidad total de 1 a 10 clips.");
  const targetDuration = Math.min(90, Math.max(15, Number(job.source.clipDuration) || 30));
  const digest = createHash("sha256").update(`${job.id}:capture-clips`).digest("hex");
  const outputId = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const store = new JobStore();
  const existing = await store.get(`bestclips-${outputId}`);
  if (existing) return existing;
  return store.enqueueMedia("MEDIA_CLIPS", outputId, {
    projectId, count, minDuration: 15, maxDuration: targetDuration + 10,
    targetDuration, subtitles: job.source.subtitles !== false,
    contentProfile: job.source.contentProfile || "GAMING",
    onlyChatReactions: job.source.onlyChatReactions === true,
    preferChatReactions: job.source.preferChatReactions === true,
    chatReactionLagSeconds: job.source.chatReactionLagSeconds || 0,
    excludedReactionPeaks: job.source.excludedReactionPeaks || [],
    ...(job.source.analysisProvider === "heuristic" ? { analysisProvider: "heuristic" } : {}),
  });
}

/** Idempotent bridge from each closed recorder segment into existing media jobs. */
export async function queueCapturedSegment({ file, index, job, signal, liveObservation }) {
  const digest = createHash("sha256").update(`${job.id}:segment:${index}`).digest("hex");
  const projectId = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const outputDigest = createHash("sha256").update(`${projectId}:clips`).digest("hex");
  const outputId = `${outputDigest.slice(0,8)}-${outputDigest.slice(8,12)}-5${outputDigest.slice(13,16)}-a${outputDigest.slice(17,20)}-${outputDigest.slice(20,32)}`;
  const directory = path.join(getStorageRoot(), "uploads", projectId);
  await mkdir(directory, { recursive: true });
  let project = await loadProjectFile(projectId);
  if (!project) {
    signal?.throwIfAborted();
    const media = path.join(directory, "source.mp4");
    await runProcess(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-y", "-i", file, "-c", "copy", "-movflags", "+faststart", media], { signal, timeoutMs: 120000 });
    const technical = await probeMedia(media, { signal });
    await createPoster(media, path.join(directory, "poster.jpg"), Math.min(1, technical.durationSeconds / 2), { signal });
    project = { id: projectId, createdAt: new Date().toISOString(), source: {
      projectId, originalName: `live-segment-${index}.mp4`, storedName: "source.mp4",
      relativePath: path.posix.join("uploads", projectId, "source.mp4"),
      sizeBytes: (await stat(media)).size, ...technical,
    }, liveCapture: { ingestJobId: job.id, segmentIndex: index, publication: "DISABLED" }, ...(liveObservation ? { liveObservation } : {}) };
    await replaceProjectFile(projectId, project);
  }
  // A short final fragment stays reviewable as source, rather than inventing a
  // full-length highlight. Failed jobs stay failed until an explicit retry.
  if (project.source.durationSeconds < 15) return { projectId, queued: false };
  const store = new JobStore();
  const existing = await store.get(`bestclips-${outputId}`);
  if (existing) return { projectId, job: existing, reused: true };
  const targetDuration = Math.min(90, Math.max(15, Number(job.source.clipDuration) || 30));
  const mediaJob = await store.enqueueMedia("MEDIA_CLIPS", outputId, {
    projectId, count: 1, minDuration: 15,
    ...(job.source.analysisProvider === "heuristic" ? { analysisProvider: "heuristic" } : {}),
    maxDuration: Math.min(project.source.durationSeconds, targetDuration + 10),
    targetDuration: Math.min(project.source.durationSeconds, targetDuration),
    subtitles: job.source.subtitles !== false, contentProfile: job.source.contentProfile || "GAMING",
    onlyChatReactions: job.source.onlyChatReactions === true,
  });
  return { projectId, job: mediaJob, reused: false };
}

export function buildStreamCaptureArgs({ resolvedUrl, remaining, chunkSeconds, startNumber, outputPattern, seekSeconds = 0, liveStartAtFirstSegment = false }) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto,rtmp,rtmps",
    ...(seekSeconds > 0 ? ["-ss", String(seekSeconds)] : []),
    // The relay already chose the recovery window. FFmpeg's default live
    // start (-3) would silently skip its older buffered segments again.
    ...(liveStartAtFirstSegment ? ["-live_start_index", "0"] : []),
    "-i",
    resolvedUrl,
    "-t",
    String(remaining),
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_format",
    "mpegts",
    "-segment_time",
    String(chunkSeconds),
    "-segment_start_number",
    String(startNumber),
    "-reset_timestamps",
    "1",
    "-progress",
    "pipe:1",
    "-nostats",
    outputPattern,
  ];
}

function isSeekableCaptureInput(url) {
  try { return /\.(mp4|mov|webm)$/i.test(new URL(url).pathname); }
  catch { return /\.(mp4|mov|webm)$/i.test(url); }
}

export async function resolveStreamUrl(url, { signal } = {}) {
  if (isKickSource(url)) return (await resolveKickSource(url, { signal })).url;
  const ytdlp = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  try {
    const { stdout } = await runProcess(
      ytdlp,
      [
        "--no-playlist",
        ...providerYtDlpArgs(url),
        "--get-url",
        "-f",
        "best[protocol^=m3u8]/best",
        url,
      ],
      { signal, timeoutMs: 2 * 60 * 1000 },
    );
    const candidates = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const resolved = candidates.find((value) => /^https?:\/\//i.test(value));
    if (!resolved) throw new Error("El extractor no devolvió una fuente HLS reproducible.");
    return resolved;
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(formatRemoteImportFailure(url, error));
  }
}

export function providerYtDlpArgs() {
  // Kick uses the public viewer resolver above. Never force client imitation
  // or use an extractor fingerprint to get past a provider's access denial.
  return [];
}

export function isDirectMediaUrl(rawUrl) {
  try {
    const source = new URL(rawUrl);
    return ["http:", "https:"].includes(source.protocol) &&
      /\.(?:mp4|mov|webm|m3u8)$/i.test(source.pathname);
  } catch {
    return false;
  }
}

export function isDirectStreamInputUrl(rawUrl) {
  try {
    const source = new URL(rawUrl);
    return ["rtmp:", "rtmps:"].includes(source.protocol) || isDirectMediaUrl(rawUrl);
  } catch {
    return false;
  }
}

/** A provider-level 404 is not a transport error and cannot be retried into success. */
export function formatRemoteImportFailure(rawUrl, error) {
  const message = compactError(error);
  try {
    const source = new URL(rawUrl);
    if (/(?:^|\.)kick\.com$/i.test(source.hostname) &&
      /\[kick:live\].*\b(?:not currently live|channel is offline|livestream is offline)\b/i.test(message)) {
      return "El canal de Kick no está transmitiendo en vivo en este momento. " +
        "Un enlace al canal solo puede importarse durante un directo activo. " +
        "Para una grabación necesitarías el enlace específico del video; la importación de grabaciones de Kick sigue limitada por el extractor actual. " +
        "Si el contenido es tuyo o tienes autorización, también puedes subir el archivo. " + message;
    }
    if (/(?:^|\.)kick\.com$/i.test(source.hostname) &&
      /\b(?:HTTP Error|HTTP)\s*(?:403|404)\b/i.test(message)) {
      return "Kick rechazó la consulta de metadatos de este video (HTTP 403/404). " +
        "El extractor actual no puede importar este enlace. No es un fallo del botón: " +
        "comprueba que el video sea público y accesible; para contenido propio o autorizado, usa Subir video. " +
        message;
    }
  } catch { /* Keep the original useful failure. */ }
  return "No se pudo importar esa URL. " + message +
    " Si la plataforma exige sesión, cookies o permisos privados, usa una fuente autorizada o sube el archivo.";
}

async function downloadDirectWithFfmpeg(url, output, signal) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      "-i",
      url,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    { signal, timeoutMs: normalizeTimeout(process.env.CLIPFORGE_URL_IMPORT_TIMEOUT_MS, 6 * 60 * 60 * 1000) },
  );
}

async function probeMedia(filePath, { signal } = {}) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { stdout } = await runProcess(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { signal, timeoutMs: 2 * 60 * 1000 },
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw Object.assign(new Error("FFprobe devolvió una respuesta de metadatos inválida. El original se conserva para revisar el entorno."), { code: "INGEST_PROBE_INVALID_RESPONSE" });
  }

  const video = parsed?.streams?.find((stream) => stream?.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  const audio = parsed?.streams?.find((stream) => stream?.codec_type === "audio");
  const duration = Number(parsed?.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  if ((!video?.width && !audio) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("El archivo no contiene audio o video válidos con duración conocida.");
  }

  return {
    durationSeconds: round(duration),
    mediaKind: video ? 'VIDEO' : 'AUDIO',
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: round(parseRate(video?.avg_frame_rate || video?.r_frame_rate)),
    codec: video?.codec_name || audio?.codec_name || "desconocido",
    container: parsed?.format?.format_name?.split(",")[0] || "desconocido",
    hasAudio: parsed?.streams?.some((stream) => stream.codec_type === "audio"),
    videoDurationSeconds: Number(video?.duration) > 0 ? Number(video.duration) : null,
    audioDurationSeconds: Number(audio?.duration) > 0 ? Number(audio.duration) : null,
    trackDurationDeltaSeconds: Number(video?.duration) > 0 && Number(audio?.duration) > 0 ? Math.abs(Number(video.duration) - Number(audio.duration)) : null,
    aspectRatio:
      video ? (normalizeAspectRatio(video.display_aspect_ratio) || reduceRatio(Number(video.width), Number(video.height))) : 'AUDIO',
  };
}

async function createPoster(input, output, seekSeconds, { signal } = {}) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      Math.max(0, Number(seekSeconds) || 0).toFixed(3),
      "-i",
      input,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      output,
    ],
    { signal, timeoutMs: 2 * 60 * 1000 },
  );
}

async function findDownloadedMedia(uploadDir) {
  const names = await readdir(uploadDir);
  const preferred = names.find((name) => /^source\.mp4$/i.test(name));
  const compatible = names.find((name) => /^source\.(mp4|mov|webm)$/i.test(name));
  return preferred
    ? path.join(uploadDir, preferred)
    : compatible
      ? path.join(uploadDir, compatible)
      : null;
}

async function listStreamParts(partsDir) {
  const names = await readdir(partsDir).catch(() => []);
  return names.filter((name) => /^part-\d{6}\.ts$/.test(name)).sort();
}

async function preserveLegacyMp4StreamParts(partsDir) {
  const names = await readdir(partsDir).catch(() => []);
  await Promise.all(
    names
      .filter((name) => /^part-\d{6}\.mp4$/.test(name))
      .map((name) => rename(path.join(partsDir, name), path.join(partsDir, `${name}.legacy-preserved-${randomUUID()}`))),
  );
}

async function cleanupIngestArtifacts(uploadDir, storedName, { preserveSegments = false } = {}) {
  const entries = await readdir(uploadDir).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name !== storedName && name !== "poster.jpg")
      .filter((name) => name.endsWith(".part") || (!preserveSegments && name === ".stream-parts"))
      .map((name) => rm(path.join(uploadDir, name), { recursive: true, force: true })),
  );
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      signal: options.signal,
      killSignal: "SIGKILL",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let resourceFailure = null;
    let checkingResources = false;
    const resourceTimer = options.checkResources ? setInterval(async () => {
      if (checkingResources || settled) return;
      checkingResources = true;
      try { await options.checkResources(); }
      catch (error) { resourceFailure = error; child.kill("SIGKILL"); }
      finally { checkingResources = false; }
    }, 1000) : null;
    resourceTimer?.unref?.();
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk;
      emitLines(stdoutBuffer, chunk, options.onStdoutLine);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64_000) stderr += chunk;
      emitLines(stderrBuffer, chunk, options.onStderrLine);
    });

    const timeoutMs = Number(options.timeoutMs || 0);
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          if (resourceTimer) clearInterval(resourceTimer);
          resourceFailure = Object.assign(new Error("El proceso de ingesta excedió su tiempo máximo."), { code: "INGEST_PROCESS_TIMEOUT" });
          child.kill("SIGKILL");
          // As for cancellation, do not inspect a recorder's last fragment
          // until its process and output pipes have actually closed.
        }, timeoutMs)
      : null;
    timer?.unref?.();

    child.on("error", (error) => {
      if (settled) return;
      // Wait for the recorder to exit before recovering its last TS fragment.
      if (error.name === "AbortError" && child.pid) { resourceFailure = error; return; }
      settled = true;
      if (timer) clearTimeout(timer);
      if (resourceTimer) clearInterval(resourceTimer);
      reject(error);
    });
    child.on("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (resourceTimer) clearInterval(resourceTimer);
      if (resourceFailure) reject(resourceFailure);
      else if (exitSignal) reject(Object.assign(new Error("El proceso de ingesta fue interrumpido; se conservan los segmentos para reintentar su verificación."), { code: "INGEST_PROCESS_INTERRUPTED" }));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(
        new Error(
          sanitizeIngestDiagnostic(stderr) ||
            sanitizeIngestDiagnostic(stdout) ||
            `Proceso de ingesta terminó con código ${code ?? "?"}.`,
        ),
      );
    });
  });
}

function emitLines(buffer, chunk, handler) {
  if (typeof handler !== "function") return;
  buffer.value += chunk;
  const lines = buffer.value.split(/\r?\n/);
  buffer.value = lines.pop() || "";
  for (const line of lines) handler(line);
}

function makeOriginalName(url, storedName, mode) {
  const base = url.pathname.split("/").filter(Boolean).pop();
  if (base && /\.(mp4|mov|webm)$/i.test(base)) return base.slice(0, 180);
  return `${mode === "STREAM" ? "stream" : "url"}-${url.hostname}-${Date.now()}${path.extname(storedName) || ".mp4"}`;
}

function redactUrlForMetadata(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function compactError(error) {
  return sanitizeIngestDiagnostic(error instanceof Error ? error.message : String(error), 1200).replace(/\s+/g, " ");
}

/** Redact before taking the tail: a long signed URL must not become a bare token. */
export function sanitizeIngestDiagnostic(value, maxLength = 4000) {
  return String(value || "")
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[MEDIA_URL]")
    .replace(/\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+[^\s"'<>]+/giu, "[AUTH_REDACTED]")
    .replace(/[\w+/=-]{120,}/gu, "[LONG_VALUE_REDACTED]")
    .trim().slice(-maxLength);
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Math.round(number)))
    : fallback;
}

function parseRate(rate) {
  if (!rate) return 0;
  const [numerator, denominator] = String(rate).split("/").map(Number);
  if (!Number.isFinite(numerator)) return 0;
  return round(denominator ? numerator / denominator : numerator);
}

function normalizeAspectRatio(value) {
  if (!value || value === "0:1" || value === "N/A") return null;
  return value;
}

function reduceRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
