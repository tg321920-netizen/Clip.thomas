import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialVault } from "../services/security/CredentialVault.mjs";

class MemoryKv {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) || null;
  }
  async set(key, value) {
    this.map.set(key, value);
    return true;
  }
  async delete(key) {
    return this.map.delete(key);
  }
}

test("credential vault restores encrypted OAuth credentials from shared KV", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-kv-"));
  const previous = process.env.CLIPFORGE_STORAGE_ROOT;
  process.env.CLIPFORGE_STORAGE_ROOT = root;
  const key = randomBytes(32);
  const kv = new MemoryKv();
  const channelId = "7e3c2a01-7d6f-4e9f-b461-8f7f1a3d2c90";

  try {
    const first = new CredentialVault({ key, kv });
    await first.set(channelId, {
      accessToken: "access-test",
      refreshToken: "refresh-test",
      externalAccountId: "youtube-channel",
    });

    await rm(path.join(root, "credentials"), {
      recursive: true,
      force: true,
    });

    const second = new CredentialVault({ key, kv });
    const restored = await second.get(channelId);

    assert.equal(restored.accessToken, "access-test");
    assert.equal(restored.refreshToken, "refresh-test");
    assert.equal(restored.externalAccountId, "youtube-channel");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_ROOT;
    else process.env.CLIPFORGE_STORAGE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
