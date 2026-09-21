import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_UPLOAD_BYTES,
  sanitizeOriginalName,
  validateUploadDescriptor,
} from "../lib/upload-policy.mjs";

test("accepts supported MP4 uploads", () => {
  const result = validateUploadDescriptor({
    filename: "video.mp4",
    mimeType: "video/mp4",
    size: 1024,
  });

  assert.equal(result.ok, true);
  assert.equal(result.extension, "mp4");
});

test("accepts MOV and WebM MIME types", () => {
  assert.equal(
    validateUploadDescriptor({
      filename: "clip.mov",
      mimeType: "video/quicktime",
      size: 2048,
    }).ok,
    true,
  );

  assert.equal(
    validateUploadDescriptor({
      filename: "clip.webm",
      mimeType: "video/webm; codecs=vp9",
      size: 2048,
    }).ok,
    true,
  );
});

test("allows octet-stream only when the extension is supported", () => {
  assert.equal(
    validateUploadDescriptor({
      filename: "camera.mp4",
      mimeType: "application/octet-stream",
      size: 2048,
    }).ok,
    true,
  );

  assert.equal(
    validateUploadDescriptor({
      filename: "camera.exe",
      mimeType: "application/octet-stream",
      size: 2048,
    }).ok,
    false,
  );
});

test("rejects unsupported extensions", () => {
  const result = validateUploadDescriptor({
    filename: "video.exe",
    mimeType: "video/mp4",
    size: 1024,
  });

  assert.equal(result.ok, false);
});

test("rejects a supported extension with an unsupported MIME type", () => {
  const result = validateUploadDescriptor({
    filename: "video.mp4",
    mimeType: "text/plain",
    size: 1024,
  });

  assert.equal(result.ok, false);
});

test("rejects empty files", () => {
  const result = validateUploadDescriptor({
    filename: "video.mp4",
    mimeType: "video/mp4",
    size: 0,
  });

  assert.equal(result.ok, false);
});

test("accepts the exact local size limit", () => {
  const result = validateUploadDescriptor({
    filename: "video.webm",
    mimeType: "video/webm",
    size: MAX_UPLOAD_BYTES,
  });

  assert.equal(result.ok, true);
});

test("rejects files above the local limit", () => {
  const result = validateUploadDescriptor({
    filename: "video.webm",
    mimeType: "video/webm",
    size: MAX_UPLOAD_BYTES + 1,
  });

  assert.equal(result.ok, false);
});

test("sanitizes path separators and control characters from original names", () => {
  assert.equal(
    sanitizeOriginalName("../folder\\video\u0000.mp4"),
    ".._folder_video_.mp4",
  );
});

test("limits very long original names", () => {
  const value = sanitizeOriginalName(`${"a".repeat(300)}.mp4`);
  assert.ok(value.length <= 180);
});
