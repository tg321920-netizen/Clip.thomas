import { readFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { PublishingService } from "./PublishingService.mjs";

export const PUBLISH_ONCE_YOUTUBE_CHANNEL_ID =
  "7e3c2a01-7d6f-4e9f-b461-8f7f1a3d2c90";

const MARKER =
  process.env.CLIPFORGE_CC_PODCAST_SMOKE_MARKER || "podcastlinux-194-v1";

export async function ensurePublishOnceYouTubeChannel() {
  const channels = new ChannelService();
  return channels.ensureSystemChannel({
    id: PUBLISH_ONCE_YOUTUBE_CHANNEL_ID,
    platform: "YOUTUBE",
    name: "ClipForge YouTube",
    scope: "MARKETING",
    timezone: "America/Managua",
    dailyLimit: 1,
    strategy: {
      name: "Publicación única de prueba",
      dailyPostLimit: 1,
      agentAutonomyMode: "MANUAL",
    },
  });
}

export async function publishLicensedPodcastSmokeToYouTube(channelId) {
  if (channelId !== PUBLISH_ONCE_YOUTUBE_CHANNEL_ID) {
    throw new Error("Unexpected one-time YouTube channel.");
  }

  const result = await readSmokeResult();
  if (result?.status !== "COMPLETED" || !result.projectId || !result.clipId) {
    throw new Error(
      "The licensed podcast clip is not ready yet. Wait for the smoke test to finish and try again.",
    );
  }

  const channels = new ChannelService();
  const current = await channels.getChannel(channelId);
  if (!current || current.status !== "CONNECTED") {
    throw new Error("YouTube is not connected.");
  }

  await channels.updateChannel(channelId, { publishingEnabled: true });

  const publications = new PublicationService();
  const created = await publications.createForClip({
    projectId: result.projectId,
    clipId: result.clipId,
    channelId,
    approvalRequired: true,
  });

  let publication = created.publication;

  if (["WAITING_APPROVAL", "DRAFT", "APPROVED", "FAILED"].includes(publication.status)) {
    publication = await publications.updateDraft(publication.id, {
      title: "Podcast Linux #194 — clip destacado",
      description: [
        "Clip adaptado de Podcast Linux, episodio #194 “Distros Madres II”, por Juan Febles.",
        "Fuente: https://podcastlinux.com/posts/podcastlinux/194-Podcast-Linux/",
        "Obra original y esta adaptación: Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional (CC BY-SA 4.0).",
        "Licencia: https://creativecommons.org/licenses/by-sa/4.0/",
        "Este clip mantiene la atribución y se comparte bajo la misma licencia.",
      ].join("\n"),
      hashtags: ["Linux", "PodcastLinux", "SoftwareLibre", "Podcast"],
      platformSettings: {
        privacyStatus: "public",
        madeForKids: false,
        categoryId: "28",
        tags: ["Linux", "Podcast Linux", "software libre", "podcast español"],
      },
    });

    publication = await publications.approve(publication.id, {
      consent: true,
      platformSettings: {
        privacyStatus: "public",
        madeForKids: false,
        categoryId: "28",
        tags: ["Linux", "Podcast Linux", "software libre", "podcast español"],
      },
    });

    publication = await publications.schedule(
      publication.id,
      new Date(Date.now() + 1_000).toISOString(),
    );
  }

  const publishing = new PublishingService();
  const submitted = await publishing.publishPublication(publication.id, {
    now: new Date(Date.now() + 2_000),
  });

  return {
    publication: submitted.publication,
    providerResult: submitted.providerResult,
    externalPostUrl:
      submitted.providerResult?.externalPostUrl ||
      submitted.publication?.externalPostUrl ||
      null,
  };
}

async function readSmokeResult() {
  const resultPath = path.join(
    getStorageRoot(),
    "smoke-tests",
    MARKER,
    "result.json",
  );
  return JSON.parse(await readFile(resultPath, "utf8"));
}
