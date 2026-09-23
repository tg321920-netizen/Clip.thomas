import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialVault } from "../services/security/CredentialVault.mjs";

const CHANNEL_ID = "0f99f199-192d-4900-95c6-dbbb60130ee8";

test("CredentialVault encrypts OAuth material at rest and decrypts it server-side", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-vault-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const key = randomBytes(32);
    const vault = new CredentialVault({ key });
    const credentials = {
      accessToken: "super-secret-access-token",
      refreshToken: "super-secret-refresh-token",
      pageId: "123456789",
    };

    assert.equal(vault.isConfigured(), true);
    await vault.set(CHANNEL_ID, credentials);

    const stored = await readFile(
      path.join(root, "credentials", `${CHANNEL_ID}.json`),
      "utf8",
    );

    assert.doesNotMatch(stored, /super-secret-access-token/);
    assert.doesNotMatch(stored, /super-secret-refresh-token/);
    assert.match(stored, /"ciphertext"/);

    const restored = await vault.get(CHANNEL_ID);
    assert.deepEqual(restored, credentials);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("CredentialVault refuses operation without a valid server key", async () => {
  const vault = new CredentialVault({ key: null });
  assert.equal(vault.isConfigured(), false);
  await assert.rejects(
    () => vault.get(CHANNEL_ID),
    /credential vault is not configured/i,
  );
});
