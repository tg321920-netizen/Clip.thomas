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

test("rejects unsupported extensions", () => {
  const result = validateUploadDescriptor({
    filename: "video.exe",
    mimeType: "video/mp4",
    size: 1024,
  });

  assert.equal(result.ok, false);
});

test("rejects files above the local limit", () => {
  const result = validateUploadDescriptor({
    filename: "video.webm",
    mimeType: "video/webm",
    size: MAX_UPLOAD_BYTES + 1,
  });

  assert.equal(result.ok, false);
});

test("sanitizes path separators from original names", () => {
  assert.equal(sanitizeOriginalName("../folder\\video.mp4"), ".._folder_video.mp4");
});
