import test from "node:test";
import assert from "node:assert/strict";
import { classifyStorageDurability } from "../lib/storage-durability.mjs";
test("a configured path alone cannot claim durable storage", () => {
  assert.equal(classifyStorageDurability("/var/data/clipforge", { CLIPFORGE_STORAGE_DIR: "/var/data/clipforge" }).durable, false);
});
test("temporary paths remain ephemeral even when a flag is incorrectly set", () => {
  assert.equal(classifyStorageDurability("/tmp/clipforge", { CLIPFORGE_STORAGE_DIR: "/tmp/clipforge", CLIPFORGE_STORAGE_PERSISTENT: "true" }).durable, false);
});
test("a verified persistent mount needs an explicit operator acknowledgement", () => {
  assert.equal(classifyStorageDurability("/var/data/clipforge", { CLIPFORGE_STORAGE_DIR: "/var/data/clipforge", CLIPFORGE_STORAGE_PERSISTENT: "true" }).durable, true);
});
