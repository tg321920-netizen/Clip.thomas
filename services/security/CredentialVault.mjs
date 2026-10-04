import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { createRedisKvFromEnv } from "../../lib/redis-kv.mjs";

const VERSION = 1;
const ALGORITHM = "aes-256-gcm";

export class CredentialVault {
  constructor(options = {}) {
    this.key = Object.prototype.hasOwnProperty.call(options, "key")
      ? options.key
      : loadMasterKey();
    this.kv = Object.prototype.hasOwnProperty.call(options, "kv")
      ? options.kv
      : createRedisKvFromEnv();
  }

  isConfigured() {
    return Buffer.isBuffer(this.key) && this.key.length === 32;
  }

  async get(channelId) {
    assertChannelId(channelId);
    this.#requireKey();

    if (this.kv) {
      try {
        const raw = await this.kv.get(this.#redisKey(channelId));
        if (raw) {
          const envelope = JSON.parse(raw);
          const credentials = decryptEnvelope(envelope, this.key, channelId);
          await this.#writeLocal(channelId, envelope).catch(() => undefined);
          return credentials;
        }
      } catch (error) {
        const local = await this.#readLocal(channelId);
        if (local) return decryptEnvelope(local, this.key, channelId);
        throw error;
      }
    }

    const local = await this.#readLocal(channelId);
    if (!local) return null;

    if (this.kv) {
      await this.kv
        .set(this.#redisKey(channelId), JSON.stringify(local))
        .catch(() => undefined);
    }
    return decryptEnvelope(local, this.key, channelId);
  }

  async set(channelId, credentials) {
    assertChannelId(channelId);
    this.#requireKey();

    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Credentials must be an object.");
    }

    const envelope = encryptCredentials(credentials, this.key, channelId);

    if (this.kv) {
      await this.kv.set(this.#redisKey(channelId), JSON.stringify(envelope));
      await this.#writeLocal(channelId, envelope).catch(() => undefined);
      return;
    }

    await this.#writeLocal(channelId, envelope);
  }

  async delete(channelId) {
    assertChannelId(channelId);
    if (this.kv) {
      await this.kv.delete(this.#redisKey(channelId));
    }
    await rm(this.#path(channelId), { force: true });
  }

  async #readLocal(channelId) {
    try {
      return JSON.parse(await readFile(this.#path(channelId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async #writeLocal(channelId, envelope) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = this.#path(channelId);
    const temp = path.join(
      directory,
      `.${channelId}.${process.pid}.${Date.now()}.tmp`,
    );

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

  #redisKey(channelId) {
    return `clipforge:oauth:v1:${channelId}`;
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
