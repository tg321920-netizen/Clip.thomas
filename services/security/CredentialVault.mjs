import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const VERSION = 1;
const ALGORITHM = "aes-256-gcm";

export class CredentialVault {
  constructor(options = {}) {
    this.key = Object.prototype.hasOwnProperty.call(options, "key")
      ? options.key
      : loadMasterKey();
  }

  isConfigured() {
    return Buffer.isBuffer(this.key) && this.key.length === 32;
  }

  async get(channelId) {
    assertChannelId(channelId);
    this.#requireKey();

    try {
      const envelope = JSON.parse(await readFile(this.#path(channelId), "utf8"));
      return decryptEnvelope(envelope, this.key, channelId);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async set(channelId, credentials) {
    assertChannelId(channelId);
    this.#requireKey();

    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Credentials must be an object.");
    }

    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const envelope = encryptCredentials(credentials, this.key, channelId);
    const target = this.#path(channelId);
    const temp = path.join(directory, `.${channelId}.${process.pid}.${Date.now()}.tmp`);

    await writeFile(temp, JSON.stringify(envelope, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(channelId) {
    assertChannelId(channelId);
    await rm(this.#path(channelId), { force: true });
  }

  #requireKey() {
    if (!this.isConfigured()) {
      throw new Error(
        "Credential vault is not configured. CLIPFORGE_CREDENTIALS_KEY must be a base64-encoded 32-byte key.",
      );
    }
  }

  #directory() {
    return path.join(getStorageRoot(), "credentials");
  }

  #path(channelId) {
    return path.join(this.#directory(), `${channelId}.json`);
  }
}

export function encryptCredentials(credentials, key, channelId) {
  assertKey(key);
  assertChannelId(channelId);

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(channelId, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

export function decryptEnvelope(envelope, key, channelId) {
  assertKey(key);
  assertChannelId(channelId);

  if (
    envelope?.version !== VERSION ||
    envelope?.algorithm !== ALGORITHM ||
    typeof envelope?.iv !== "string" ||
    typeof envelope?.tag !== "string" ||
    typeof envelope?.ciphertext !== "string"
  ) {
    throw new Error("Credential envelope is invalid or unsupported.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(channelId, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

function loadMasterKey() {
  const encoded = process.env.CLIPFORGE_CREDENTIALS_KEY?.trim();
  if (!encoded) return null;

  let key;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }

  return key.length === 32 ? key : null;
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Credential encryption key must contain exactly 32 bytes.");
  }
}

function assertChannelId(channelId) {
  if (!isProjectId(channelId)) throw new Error("Invalid channel id.");
}
