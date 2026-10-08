import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { createRedisKvFromEnv } from "../../lib/redis-kv.mjs";

const INDEX_KEY = "clipforge:channels:v1:index";

export class ChannelRepository {
  constructor(options = {}) {
    this.kv = Object.hasOwn(options, "kv")
      ? options.kv
      : createRedisKvFromEnv();
  }

  async list() {
    const records = new Map();

    for (const record of await this.#listLocal()) {
      records.set(record.id, record);
    }

    if (this.kv) {
      try {
        const rawIndex = await this.kv.get(INDEX_KEY);
        const ids = parseIndex(rawIndex);
        const shared = await Promise.all(
          ids.map(async (id) => {
            const raw = await this.kv.get(this.#redisKey(id));
            return raw ? JSON.parse(raw) : null;
          }),
        );
        for (const record of shared.filter(Boolean)) {
          records.set(record.id, record);
          await this.#writeLocal(record).catch(() => undefined);
        }
      } catch (error) {
        if (records.size === 0) throw error;
      }
    }

    return [...records.values()].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  }

  async get(channelId) {
    assertId(channelId);

    if (this.kv) {
      try {
        const raw = await this.kv.get(this.#redisKey(channelId));
        if (raw) {
          const record = JSON.parse(raw);
          await this.#writeLocal(record).catch(() => undefined);
          return record;
        }
      } catch (error) {
        const local = await this.#readLocal(channelId);
        if (local) return local;
        throw error;
      }
    }

    return this.#readLocal(channelId);
  }

  async save(record) {
    assertId(record?.id);

    if (this.kv) {
      await this.kv.set(this.#redisKey(record.id), JSON.stringify(record));
      await this.#addToIndex(record.id);
      await this.#writeLocal(record).catch(() => undefined);
      return record;
    }

    await this.#writeLocal(record);
    return record;
  }

  async delete(channelId) {
    assertId(channelId);

    if (this.kv) {
      await this.kv.delete(this.#redisKey(channelId));
      await this.#removeFromIndex(channelId);
    }

    await rm(this.#path(channelId), { force: true });
  }

  async #listLocal() {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const names = await readdir(directory);
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return JSON.parse(await readFile(path.join(directory, name), "utf8"));
          } catch {
            return null;
          }
        }),
    );

    return records.filter(Boolean);
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

  async #writeLocal(record) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const target = this.#path(record.id);
    const temp = path.join(
      directory,
      `.${record.id}.${process.pid}.${Date.now()}.tmp`,
    );

    await writeFile(temp, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #addToIndex(channelId) {
    const ids = parseIndex(await this.kv.get(INDEX_KEY));
    if (!ids.includes(channelId)) {
      ids.push(channelId);
      await this.kv.set(INDEX_KEY, JSON.stringify(ids));
    }
  }

  async #removeFromIndex(channelId) {
    const ids = parseIndex(await this.kv.get(INDEX_KEY));
    const next = ids.filter((id) => id !== channelId);
    if (next.length !== ids.length) {
      await this.kv.set(INDEX_KEY, JSON.stringify(next));
    }
  }

  #redisKey(channelId) {
    return `clipforge:channels:v1:${channelId}`;
  }

  #directory() {
    return path.join(getStorageRoot(), "channels");
  }

  #path(channelId) {
    return path.join(this.#directory(), `${channelId}.json`);
  }
}

function parseIndex(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id) => isProjectId(id))
      : [];
  } catch {
    return [];
  }
}

function assertId(value) {
  if (!isProjectId(value)) {
    throw new Error("Invalid channel id.");
  }
}
