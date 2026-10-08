import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { createRedisKvFromEnv } from "../../lib/redis-kv.mjs";

const INDEX_KEY = "clipforge:agent-executions:v1:index";

export class AgentExecutionRepository {
  constructor(options = {}) {
    this.kv = Object.hasOwn(options, "kv")
      ? options.kv
      : createRedisKvFromEnv();
  }

  async get(id) {
    assertId(id);

    if (this.kv) {
      try {
        const raw = await this.kv.get(this.#redisKey(id));
        if (raw) {
          const record = JSON.parse(raw);
          await this.#writeLocal(record).catch(() => undefined);
          return record;
        }
      } catch (error) {
        const local = await this.#readLocal(id);
        if (local) return local;
        throw error;
      }
    }

    return this.#readLocal(id);
  }

  async list(filters = {}) {
    const records = new Map();

    for (const record of await this.#listLocal()) {
      records.set(record.id, record);
    }

    if (this.kv) {
      try {
        const ids = parseIndex(await this.kv.get(INDEX_KEY));
        for (const id of ids) {
          const raw = await this.kv.get(this.#redisKey(id));
          if (!raw) continue;
          const record = JSON.parse(raw);
          records.set(record.id, record);
          await this.#writeLocal(record).catch(() => undefined);
        }
      } catch (error) {
        if (records.size === 0) throw error;
      }
    }

    const statuses = filters.status
      ? new Set(Array.isArray(filters.status) ? filters.status : [filters.status])
      : null;

    return [...records.values()]
      .filter((record) => !statuses || statuses.has(record.status))
      .filter((record) => !filters.channelId || record.task?.channelId === filters.channelId)
      .filter((record) => !filters.workflowId || record.task?.workflowId === filters.workflowId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
    await mkdir(this.#directory(), { recursive: true });
    const names = await readdir(this.#directory());
    const records = [];

    for (const name of names.filter((value) => value.endsWith(".json"))) {
      try {
        records.push(
          JSON.parse(await readFile(path.join(this.#directory(), name), "utf8")),
        );
      } catch {
        // Ignore a corrupt local cache entry; shared KV remains authoritative when configured.
      }
    }

    return records;
  }

  async #readLocal(id) {
    try {
      return JSON.parse(await readFile(this.#path(id), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async #writeLocal(record) {
    await mkdir(this.#directory(), { recursive: true });
    const target = this.#path(record.id);
    const temp = path.join(
      this.#directory(),
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

  async #addToIndex(id) {
    const ids = parseIndex(await this.kv.get(INDEX_KEY));
    if (ids.includes(id)) return;
    ids.push(id);
    await this.kv.set(INDEX_KEY, JSON.stringify(ids));
  }

  #redisKey(id) {
    return `clipforge:agent-executions:v1:${id}`;
  }

  #directory() {
    return path.join(getStorageRoot(), "agent", "executions");
  }

  #path(id) {
    return path.join(this.#directory(), `${id}.json`);
  }
}

function parseIndex(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id) => isProjectId(String(id || "")))
      : [];
  } catch {
    return [];
  }
}

function assertId(value) {
  if (!isProjectId(String(value || ""))) throw new Error("Invalid agent execution id.");
}
