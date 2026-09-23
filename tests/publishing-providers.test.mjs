import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TikTokProvider } from "../services/publishing/TikTokProvider.mjs";
import { YouTubeProvider } from "../services/publishing/YouTubeProvider.mjs";
import { FacebookProvider } from "../services/publishing/FacebookProvider.mjs";
import { createPublishingProvider } from "../services/publishing/createPublishingProvider.mjs";

const publication = {
  title: "Clip de prueba",
  description: "Descripción de prueba",
  hashtags: ["#clipforge", "#video"],
  consentAt: "2030-01-01T00:00:00.000Z",
};

test("TikTok provider requires express consent before any API request", async () => {
  let calls = 0;
  const provider = new TikTokProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    () =>
      provider.publish({
        publication: { ...publication, consentAt: null },
        credentials: { accessToken: "token" },
        settings: { privacyLevel: "SELF_ONLY" },
        media: {
          publicUrl: "https://media.example.com/clip.mp4",
          durationSeconds: 20,
        },
      }),
    /express user consent/i,
  );
  assert.equal(calls, 0);
});

test("TikTok provider queries creator info and only posts an allowed privacy level", async () => {
  const requests = [];
  const provider = new TikTokProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });

      if (String(url).includes("creator_info/query")) {
        return jsonResponse({
          data: {
            privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
            max_video_post_duration_sec: 300,
          },
          error: { code: "ok", message: "" },
        });
      }

      return jsonResponse({
        data: { publish_id: "v_pub_url~test" },
        error: { code: "ok", message: "" },
      });
    },
  });

  const result = await provider.publish({
    publication,
    credentials: { accessToken: "token" },
    settings: {
      privacyLevel: "SELF_ONLY",
      disableComment: true,
    },
    media: {
      publicUrl: "https://media.example.com/clip.mp4",
      durationSeconds: 20,
    },
  });

  assert.equal(result.externalPostId, "v_pub_url~test");
  assert.equal(requests.length, 2);

  const initBody = JSON.parse(String(requests[1].init.body));
  assert.equal(initBody.source_info.source, "PULL_FROM_URL");
  assert.equal(initBody.post_info.privacy_level, "SELF_ONLY");
  assert.equal(initBody.post_info.disable_comment, true);
});

test("YouTube provider uses resumable upload without loading the whole video into app memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-youtube-"));
  const filePath = path.join(root, "clip.mp4");
  await writeFile(filePath, Buffer.alloc(1024, 7));

  const requests = [];
  try {
    const provider = new YouTubeProvider({
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });

        if (requests.length === 1) {
          return new Response(null, {
            status: 200,
            headers: { location: "https://upload.example.com/session" },
          });
        }

        return jsonResponse({
          id: "youtube-video-123",
          status: { uploadStatus: "uploaded" },
        });
      },
    });

    const result = await provider.publish({
      publication,
      credentials: { accessToken: "token" },
      settings: { privacyStatus: "private" },
      media: { filePath },
    });

    assert.equal(result.externalPostId, "youtube-video-123");
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /uploadType=resumable/);
    assert.equal(requests[1].url, "https://upload.example.com/session");
    assert.equal(requests[1].init.method, "PUT");
    assert.ok(requests[1].init.body instanceof ReadableStream);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Facebook provider performs start, binary upload and finish using an explicit Graph version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-facebook-"));
  const filePath = path.join(root, "clip.mp4");
  await writeFile(filePath, Buffer.alloc(2048, 3));

  const requests = [];
  try {
    const provider = new FacebookProvider({
      apiVersion: "v26.0",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });

        if (requests.length === 1) {
          return jsonResponse({
            video_id: "facebook-video-123",
            upload_url: "https://rupload.facebook.example/session",
          });
        }
        if (requests.length === 2) {
          return jsonResponse({ success: true });
        }
        return jsonResponse({ success: true });
      },
    });

    const result = await provider.publish({
      publication,
      credentials: { accessToken: "token", pageId: "page-123" },
      media: { filePath },
    });

    assert.equal(result.externalPostId, "facebook-video-123");
    assert.equal(requests.length, 3);
    assert.match(requests[0].url, /v26\.0\/page-123\/video_reels/);
    assert.equal(requests[1].init.headers.file_size, "2048");
    assert.match(requests[2].url, /upload_phase=finish/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PublishingProvider factory exposes an explicit mock only when requested", async () => {
  const mock = createPublishingProvider("TIKTOK", {
    mock: true,
    externalPostId: "mock-id",
  });
  const result = await mock.publish();

  assert.equal(result.externalPostId, "mock-id");
  assert.deepEqual(mock.requirements(), { mock: true });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
