import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { createRedisKvFromEnv } from "../../lib/redis-kv.mjs";

const INDEX_KEY = "clipforge:publications:v1:index";

export class PublicationRepository {
  constructor(options = {}) {
    this.kv = Object.hasOwn(options, "kv")
      ? options.kv
      : createRedisKvFromEnv();
  }

  async list(filters = {}) {
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

    return [...records.values()]
      .filter((record) => matches(record, filters))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async get(publicationId) {
    assertId(publicationId);

    if (this.kv) {
      try {
        const raw = await this.kv.get(this.#redisKey(publicationId));
        if (raw) {
          const record = JSON.parse(raw);
          await this.#writeLocal(record).catch(() => undefined);
          return record;
        }
      } catch (error) {
        const local = await this.#readLocal(publicationId);
        if (local) return local;
        throw error;
      }
    }

    return this.#readLocal(publicationId);
  }

  async findByIdempotencyKey(idempotencyKey) {
    const records = await this.list();
    return records.find((record) => record.idempotencyKey === idempotencyKey) || null;
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

  async #readLocal(publicationId) {
    try {
      return JSON.parse(await readFile(this.#path(publicationId), "utf8"));
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

  async #addToIndex(publicationId) {
    const ids = parseIndex(await this.kv.get(INDEX_KEY));
    if (!ids.includes(publicationId)) {
      ids.push(publicationId);
      await this.kv.set(INDEX_KEY, JSON.stringify(ids));
    }
  }

  #redisKey(publicationId) {
    return `clipforge:publications:v1:${publicationId}`;
  }

  #directory() {
    return path.join(getStorageRoot(), "publications");
  }

  #path(publicationId) {
    return path.join(this.#directory(), `${publicationId}.json`);
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

function matches(record, filters) {
  if (filters.channelId && record.channelId !== filters.channelId) return false;
  if (filters.projectId && record.projectId !== filters.projectId) return false;
  if (filters.clipId && record.clipId !== filters.clipId) return false;
  if (filters.platform && record.platform !== filters.platform) return false;

  if (filters.status) {
    const allowed = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (!allowed.includes(record.status)) return false;
  }

  return true;
}

function assertId(value) {
  if (!isProjectId(value)) throw new Error("Invalid publication id.");
}
