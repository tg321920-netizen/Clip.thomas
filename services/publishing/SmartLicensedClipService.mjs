import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { replaceProjectFile } from "../../lib/project-files.mjs";
import { transcribeProject } from "../transcription/TranscriptionService.mjs";
import { analyzeProject } from "../analysis/ContentAnalysisService.mjs";
import { createClipFromCandidate, renderClip } from "../clip/ClipService.mjs";
import { generateSubtitleTrack } from "../subtitles/SubtitleService.mjs";
import { applySpeechFocus } from "../reframe/AutoReframeService.mjs";
import { OAuthConnectionService } from "../oauth/OAuthConnectionService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { PublishingService } from "./PublishingService.mjs";
import {
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../ai/OpenAICompatibleClient.mjs";

const DEFAULT_QUERIES = [
  "podcast español entrevista",
  "podcast español tecnología",
  "charla español entrevista",
];

const EDITORIAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "hashtags", "reason"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 6 },
    reason: { type: "string" },
  },
};

export class SmartLicensedClipService {
  constructor(options = {}) {
    this.oauth = options.oauth || new OAuthConnectionService();
    this.channels = options.channels || new ChannelService();
    this.publications = options.publications || new PublicationService({
      channels: this.channels,
    });
    this.publishing = options.publishing || new PublishingService();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async discover(channelId, options = {}) {
    const channel = await this.channels.getChannel(channelId);
    if (!channel || channel.platform !== "YOUTUBE") {
      throw new Error("A connected YouTube channel is required.");
    }
    const credentials = await this.oauth.getValidCredentials(channelId);
    if (!credentials?.accessToken) {
      throw new Error("YouTube must be connected before smart clip discovery.");
    }

    const discovered = await this.#discover(credentials.accessToken, options);
    const inspected = [];
    for (const candidate of discovered.slice(0, 8)) {
      try {
        const metadata = await inspectWithYtDlp(candidate.url);
        if (!metadata.hasVideo) continue;
        inspected.push({
          ...candidate,
          heatmap: metadata.heatmap,
          heatmapPeak: metadata.heatmapPeak,
          width: metadata.width,
          height: metadata.height,
          durationSeconds: metadata.durationSeconds || candidate.durationSeconds,
          ytDlpViewCount: Number(metadata.viewCount || 0),
        });
      } catch (error) {
        console.warn("[smart-clip] discovery inspection failed", {
          url: candidate.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (inspected.filter((item) => item.heatmapPeak).length >= 4) break;
    }

    return {
      candidates: inspected.length ? inspected : discovered,
      selected: chooseSource(inspected.length ? inspected : discovered),
    };
  }

  async run(channelId, options = {}) {
    const channel = await this.channels.getChannel(channelId);
    if (!channel || channel.platform !== "YOUTUBE") {
      throw new Error("A connected YouTube channel is required.");
    }

    const credentials = await this.oauth.getValidCredentials(channelId);
    if (!credentials?.accessToken) {
      throw new Error("YouTube must be connected before smart clip discovery.");
    }

    // The previous smoke-test upload was intentionally crude. Hide it before
    // publishing the replacement so the channel does not keep the bad test.
    await this.#hidePreviousSmokeUpload(credentials.accessToken).catch((error) => {
      console.warn("[smart-clip] could not hide previous smoke upload:", error.message);
    });

    const discovered = await this.#discover(credentials.accessToken, options);
    if (discovered.length === 0) {
      throw new Error("No Creative Commons Spanish podcast-style videos were found.");
    }

    const inspected = [];
    for (const candidate of discovered.slice(0, 8)) {
      try {
        const metadata = await inspectWithYtDlp(candidate.url);
        if (!metadata.hasVideo) continue;
        inspected.push({
          ...candidate,
          heatmap: metadata.heatmap,
          heatmapPeak: metadata.heatmapPeak,
          width: metadata.width,
          height: metadata.height,
          durationSeconds: metadata.durationSeconds || candidate.durationSeconds,
          ytDlpViewCount: Number(metadata.viewCount || 0),
        });
      } catch (error) {
        console.warn("[smart-clip] metadata inspection failed", {
          url: candidate.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (inspected.filter((item) => item.heatmapPeak).length >= 4) break;
    }

    const chosen = chooseSource(inspected.length ? inspected : discovered);
    if (!chosen) throw new Error("No usable visual source was found.");

    console.log("[smart-clip] selected source", {
      title: chosen.title,
      views: chosen.viewCount,
      likes: chosen.likeCount,
      comments: chosen.commentCount,
      heatmapPeak: chosen.heatmapPeak,
      score: chosen.score,
      url: chosen.url,
    });

    const peak = chosen.heatmapPeak;
    const duration = Math.max(1, Number(chosen.durationSeconds || 0));
    const center = peak
      ? (Number(peak.start_time || 0) + Number(peak.end_time || peak.start_time || 0)) / 2
      : Math.min(duration * 0.35, 12 * 60);
    const windowSeconds = Math.min(300, Math.max(180, Number(options.windowSeconds || 240)));
    let start = Math.max(0, center - windowSeconds / 2);
    if (duration > 0 && start + windowSeconds > duration) {
      start = Math.max(0, duration - windowSeconds);
    }
    const end = duration > 0 ? Math.min(duration, start + windowSeconds) : start + windowSeconds;

    const projectId = randomUUID();
    const videoId = randomUUID();
    const uploadDir = path.join(getStorageRoot(), "uploads", projectId);
    const sourcePath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });

    console.log("[smart-clip] downloading visual highlight window", {
      start: round(start),
      end: round(end),
    });
    await downloadYouTubeSection(chosen.url, sourcePath, start, end);
    const probe = await probeVideo(sourcePath);
    const info = await stat(sourcePath);
    const now = new Date().toISOString();

    await replaceProjectFile(projectId, {
      id: projectId,
      createdAt: now,
      source: {
        projectId,
        videoId,
        originalName: `licensed-youtube-${chosen.videoId}.mp4`,
        storedName: "source.mp4",
        sizeBytes: info.size,
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        codec: probe.codec,
        container: probe.container,
        aspectRatio: probe.aspectRatio,
        relativePath: path.posix.join("uploads", projectId, "source.mp4"),
        sourceUrl: `/api/projects/${projectId}/source`,
        originUrl: chosen.url,
        ingestMode: "SMART_LICENSED_VIDEO",
        rights: {
          license: "Creative Commons",
          licenseCode: "creativeCommon",
          sourcePlatform: "YouTube",
          sourceVideoId: chosen.videoId,
          sourceTitle: chosen.title,
          sourceChannel: chosen.channelTitle,
          sourceUrl: chosen.url,
        },
        discoveryEvidence: {
          query: chosen.query,
          viewCount: chosen.viewCount,
          likeCount: chosen.likeCount,
          commentCount: chosen.commentCount,
          publishedAt: chosen.publishedAt,
          popularityScore: chosen.score,
          heatmapPeak: chosen.heatmapPeak || null,
          selectedWindow: { start: round(start), end: round(end) },
        },
      },
    });

    console.log("[smart-clip] transcribing visual source...");
    await transcribeProject(projectId, {
      language: "es",
      chunkDurationSeconds: 600,
    });

    console.log("[smart-clip] analyzing clip candidates...");
    const analysisResult = await analyzeProject(projectId, {
      providerName: process.env.CLIPFORGE_ANALYSIS_PROVIDER || "heuristic",
      minDuration: 95,
      maxDuration: 180,
      targetDuration: 120,
      maxCandidates: 7,
    });

    const candidates = Array.isArray(analysisResult.analysis?.candidates)
      ? analysisResult.analysis.candidates
      : [];
    if (candidates.length === 0) throw new Error("No highlight candidates were found.");

    const selectedCandidate = [...candidates]
      .filter((candidate) => Number(candidate.duration || 0) > 90)
      .sort(
        (a, b) => Number(b.viralScore || 0) - Number(a.viralScore || 0),
      )[0];

    if (!selectedCandidate) {
      throw new Error("No candidate longer than 90 seconds passed the highlight analysis.");
    }

    const prepared = await createClipFromCandidate(projectId, selectedCandidate.id, {
      framingMode: "FILL",
      quality: "BALANCED",
    });

    console.log("[smart-clip] generating word-focused subtitles...");
    await generateSubtitleTrack(projectId, prepared.clip.id, {
      style: "KARAOKE",
      enabled: true,
    });

    console.log("[smart-clip] applying smooth speech zoom...");
    await applySpeechFocus(projectId, prepared.clip.id, {
      zoom: 1.10,
      attackMs: 700,
      releaseMs: 900,
      mergeGapMs: 250,
      paddingBeforeMs: 120,
      paddingAfterMs: 180,
    });

    console.log("[smart-clip] rendering real visual 9:16 clip with subtitles and smooth zoom...");
    await renderClip(projectId, prepared.clip.id, (progress) => {
      if (progress === 100 || progress % 25 === 0) {
        console.log("[smart-clip] render progress", progress);
      }
    });

    const editorial = await createEditorial({
      source: chosen,
      candidate: selectedCandidate,
    });

    console.log("[smart-clip] editorial", {
      title: editorial.title,
      sourceViews: chosen.viewCount,
      agentReason: editorial.reason,
    });

    await this.channels.updateChannel(channelId, { publishingEnabled: true });

    const created = await this.publications.createForClip({
      projectId,
      clipId: prepared.clip.id,
      channelId,
      approvalRequired: true,
    });

    let publication = await this.publications.updateDraft(created.publication.id, {
      title: editorial.title,
      description: [
        editorial.description,
        "",
        `Fuente: ${chosen.title} — ${chosen.channelTitle}`,
        `Video original: ${chosen.url}`,
        "Licencia del video fuente: Creative Commons (verificada mediante YouTube Data API).",
        "",
        ...editorial.hashtags.map((tag) => normalizeHashtag(tag)).filter(Boolean),
      ].join("\n"),
      hashtags: editorial.hashtags,
      platformSettings: {
        privacyStatus: "public",
        madeForKids: false,
        categoryId: "22",
        tags: editorial.hashtags.map((tag) => String(tag).replace(/^#/, "")).slice(0, 12),
      },
    });

    publication = await this.publications.approve(publication.id, {
      consent: true,
      platformSettings: {
        privacyStatus: "public",
        madeForKids: false,
        categoryId: "22",
        tags: editorial.hashtags.map((tag) => String(tag).replace(/^#/, "")).slice(0, 12),
      },
    });

    publication = await this.publications.schedule(
      publication.id,
      new Date(Date.now() + 1000).toISOString(),
    );

    const submitted = await this.publishing.publishPublication(publication.id, {
      now: new Date(Date.now() + 2000),
    });

    return {
      source: chosen,
      projectId,
      clipId: prepared.clip.id,
      candidate: selectedCandidate,
      editorial,
      publication: submitted.publication,
      providerResult: submitted.providerResult,
      externalPostUrl:
        submitted.providerResult?.externalPostUrl ||
        submitted.publication?.externalPostUrl ||
        null,
    };
  }

  async #discover(accessToken, options = {}) {
    const queries = Array.isArray(options.queries) && options.queries.length
      ? options.queries
      : DEFAULT_QUERIES;
    const ids = new Map();

    for (const query of queries.slice(0, 4)) {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("videoLicense", "creativeCommon");
      url.searchParams.set("videoDuration", "long");
      url.searchParams.set("order", "viewCount");
      url.searchParams.set("relevanceLanguage", "es");
      url.searchParams.set("safeSearch", "strict");
      url.searchParams.set("maxResults", "25");
      url.searchParams.set("q", query);

      const body = await fetchYouTubeJson(this.fetchImpl, url, accessToken);
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        const id = String(item?.id?.videoId || "").trim();
        if (id && !ids.has(id)) ids.set(id, query);
      }
    }

    const allIds = [...ids.keys()];
    if (allIds.length === 0) return [];

    const videos = [];
    for (let i = 0; i < allIds.length; i += 50) {
      const batch = allIds.slice(i, i + 50);
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "snippet,statistics,status,contentDetails");
      url.searchParams.set("id", batch.join(","));
      const body = await fetchYouTubeJson(this.fetchImpl, url, accessToken);
      videos.push(...(Array.isArray(body?.items) ? body.items : []));
    }

    const normalized = videos
      .map((item) => normalizeVideo(item, ids.get(item.id)))
      .filter(Boolean)
      .filter((item) => item.durationSeconds >= 20 * 60)
      .filter((item) => item.statusLicense === "creativeCommon")
      .filter((item) => /podcast|entrevista|charla|conversaci[oó]n|episodio|directo/i.test(
        `${item.title} ${item.description}`,
      ));

    const maxViews = Math.max(1, ...normalized.map((item) => item.viewCount));
    const maxEngagement = Math.max(0.0001, ...normalized.map((item) => item.engagementRate));

    for (const item of normalized) {
      const viewScore = Math.log10(item.viewCount + 10) / Math.log10(maxViews + 10);
      const engagementScore = Math.min(1, item.engagementRate / maxEngagement);
      const ageDays = Math.max(0, (Date.now() - Date.parse(item.publishedAt || 0)) / 86400000);
      const recencyScore = Math.max(0, 1 - ageDays / (365 * 8));
      item.score = round(viewScore * 70 + engagementScore * 20 + recencyScore * 10);
    }

    return normalized.sort((a, b) => b.score - a.score || b.viewCount - a.viewCount);
  }

  async #hidePreviousSmokeUpload(accessToken) {
    const search = new URL("https://www.googleapis.com/youtube/v3/search");
    search.searchParams.set("part", "snippet");
    search.searchParams.set("forMine", "true");
    search.searchParams.set("type", "video");
    search.searchParams.set("maxResults", "25");
    search.searchParams.set("q", "Podcast Linux");
    const body = await fetchYouTubeJson(this.fetchImpl, search, accessToken);
    const items = Array.isArray(body?.items) ? body.items : [];
    const target = items.find((item) => {
      const title = String(item?.snippet?.title || "");
      return (
        title.includes("Podcast Linux #194") ||
        title.includes("Las distros Linux también tienen")
      );
    });
    const id = String(target?.id?.videoId || "").trim();
    if (!id) return { hidden: false };

    const response = await this.fetchImpl(
      "https://www.googleapis.com/youtube/v3/videos?part=status",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          status: { privacyStatus: "private" },
        }),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        result?.error?.message || `YouTube hide failed with HTTP ${response.status}.`,
      );
    }
    console.log("[smart-clip] previous smoke upload set to private", { videoId: id });
    return { hidden: true, videoId: id };
  }
}

function normalizeVideo(item, query) {
  const id = String(item?.id || "").trim();
  if (!id) return null;
  const viewCount = Number(item?.statistics?.viewCount || 0);
  const likeCount = Number(item?.statistics?.likeCount || 0);
  const commentCount = Number(item?.statistics?.commentCount || 0);
  const engagementRate = viewCount > 0 ? (likeCount + commentCount * 2) / viewCount : 0;
  return {
    videoId: id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    query,
    title: String(item?.snippet?.title || "").trim(),
    description: String(item?.snippet?.description || "").trim().slice(0, 3000),
    channelTitle: String(item?.snippet?.channelTitle || "").trim(),
    publishedAt: item?.snippet?.publishedAt || null,
    durationSeconds: parseIsoDuration(item?.contentDetails?.duration),
    statusLicense: String(item?.status?.license || ""),
    viewCount,
    likeCount,
    commentCount,
    engagementRate,
    score: 0,
  };
}

function chooseSource(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return [...items].sort((a, b) => {
    const aHeat = a.heatmapPeak ? Number(a.heatmapPeak.value || 0) : -1;
    const bHeat = b.heatmapPeak ? Number(b.heatmapPeak.value || 0) : -1;
    const aComposite = Number(a.score || 0) + (aHeat >= 0 ? 18 + aHeat * 12 : 0);
    const bComposite = Number(b.score || 0) + (bHeat >= 0 ? 18 + bHeat * 12 : 0);
    return bComposite - aComposite || Number(b.viewCount || 0) - Number(a.viewCount || 0);
  })[0];
}

async function inspectWithYtDlp(url) {
  const ytdlp = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const { stdout } = await run(ytdlp, [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    url,
  ], 180000);
  const body = JSON.parse(stdout);
  const formats = Array.isArray(body?.formats) ? body.formats : [];
  const hasVideo = formats.some((format) =>
    format?.vcodec && format.vcodec !== "none" && Number(format?.height || 0) > 0
  );
  const heatmap = Array.isArray(body?.heatmap)
    ? body.heatmap.filter((entry) =>
        Number.isFinite(Number(entry?.start_time)) &&
        Number.isFinite(Number(entry?.value))
      )
    : [];
  const heatmapPeak = heatmap.length
    ? [...heatmap].sort((a, b) => Number(b.value || 0) - Number(a.value || 0))[0]
    : null;
  return {
    hasVideo,
    heatmap,
    heatmapPeak,
    viewCount: Number(body?.view_count || 0),
    width: Number(body?.width || 0),
    height: Number(body?.height || 0),
    durationSeconds: Number(body?.duration || 0),
  };
}

async function downloadYouTubeSection(url, outputPath, start, end) {
  const ytdlp = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const ffmpegPath = process.env.FFMPEG_PATH?.trim();
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--download-sections",
    `*${Math.max(0, start).toFixed(3)}-${Math.max(start + 1, end).toFixed(3)}`,
    "--force-keyframes-at-cuts",
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "-o",
    outputPath,
  ];
  if (ffmpegPath) {
    args.push("--ffmpeg-location", path.dirname(ffmpegPath));
  }
  args.push(url);
  await run(ytdlp, args, 20 * 60 * 1000);
}

async function probeVideo(filePath) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    filePath,
  ], 120000);
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration || video?.duration || 0);
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  if (!width || !height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Downloaded source is not a valid visual video.");
  }
  return {
    durationSeconds: round(duration),
    width,
    height,
    fps: round(parseRate(video.avg_frame_rate || video.r_frame_rate)),
    codec: video.codec_name || "unknown",
    container: parsed.format?.format_name?.split(",")[0] || "unknown",
    aspectRatio: reduceRatio(width, height),
  };
}

async function createEditorial({ source, candidate }) {
  const fallback = {
    title: creativeFallbackTitle(source, candidate),
    description:
      "Un fragmento breve de una conversación en español que concentra una de las partes más interesantes del video original.",
    hashtags: ["#Podcast", "#Entrevista", "#Shorts"],
    reason: "Fallback editorial basado en el fragmento seleccionado y las métricas verificadas.",
  };

  const apiKey = String(process.env.CLIPFORGE_ZAI_API_KEY || "").trim();
  const model = String(process.env.CLIPFORGE_ZAI_MODEL || "").trim();
  if (!apiKey || !model) return fallback;

  try {
    const config = resolveOpenAICompatibleConfig({
      apiKey,
      model,
      baseUrl: process.env.CLIPFORGE_ZAI_BASE_URL || "https://api.z.ai/api/paas/v4",
      apiStyle: process.env.CLIPFORGE_ZAI_API_STYLE || "chat-completions",
      temperature: 0.65,
      maxOutputTokens: 900,
    });
    const result = await requestStructuredJson({
      config,
      name: "smart_clip_editorial",
      schema: EDITORIAL_SCHEMA,
      instructions: [
        "Eres el editor senior de shorts de ClipForge.",
        "Crea un título en español, claro, creativo y específico al fragmento.",
        "No uses títulos genéricos como 'clip destacado'.",
        "No inventes hechos ni cifras.",
        "Aprovecha la frase o idea más fuerte del fragmento.",
        "El título debe funcionar en YouTube Shorts y no superar 90 caracteres.",
        "La descripción debe ser breve y explicar por qué el fragmento interesa.",
        "Devuelve de 3 a 6 hashtags relevantes.",
      ].join("\n"),
      input: {
        source: {
          title: source.title,
          channel: source.channelTitle,
          views: source.viewCount,
          likes: source.likeCount,
          comments: source.commentCount,
          publishedAt: source.publishedAt,
          heatmapPeak: source.heatmapPeak || null,
        },
        clip: {
          text: String(candidate?.text || candidate?.summary || candidate?.reason || "").slice(0, 5000),
          startTime: candidate?.startTime,
          endTime: candidate?.endTime,
          viralScore: candidate?.viralScore,
        },
      },
      fetchImpl: globalThis.fetch,
    });

    const parsed = result?.parsed || {};
    const title = String(parsed.title || "").trim().slice(0, 90);
    if (!title) return fallback;
    return {
      title,
      description: String(parsed.description || fallback.description).trim().slice(0, 1200),
      hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : fallback.hashtags)
        .map((tag) => normalizeHashtag(tag))
        .filter(Boolean)
        .slice(0, 6),
      reason: String(parsed.reason || "Agent editorial selection.").trim().slice(0, 600),
    };
  } catch (error) {
    console.warn("[smart-clip] ZAI editorial fallback:", error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

function creativeFallbackTitle(source, candidate) {
  const text = String(candidate?.text || candidate?.summary || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) {
    const sentence = text.split(/[.!?]/).map((part) => part.trim()).find((part) => part.length >= 24);
    if (sentence) return `${sentence.slice(0, 72)}${sentence.length > 72 ? "…" : ""} #Shorts`;
  }
  const base = String(source?.title || "Una idea que vale la pena escuchar").replace(/\s+/g, " ").trim();
  return `${base.slice(0, 72)}${base.length > 72 ? "…" : ""} #Shorts`;
}

async function fetchYouTubeJson(fetchImpl, url, accessToken) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message || `YouTube API returned HTTP ${response.status}.`);
  }
  return body;
}

function run(command, args, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timeout: ${command}`));
    }, timeoutMs) : null;
    timer?.unref?.();
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().slice(-4000) || `${command} exited with code ${code}`));
    });
  });
}

function parseIsoDuration(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function parseRate(rate) {
  const [a, b] = String(rate || "0").split("/").map(Number);
  if (!Number.isFinite(a)) return 0;
  return b ? a / b : a;
}

function reduceRatio(width, height) {
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

function gcd(a, b) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function normalizeHashtag(tag) {
  const clean = String(tag || "").trim().replace(/\s+/g, "");
  if (!clean) return "";
  return clean.startsWith("#") ? clean.slice(0, 80) : `#${clean.slice(0, 79)}`;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
