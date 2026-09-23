import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class PublicationRepository {
  async list(filters = {}) {
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

    return records
      .filter(Boolean)
      .filter((record) => matches(record, filters))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async get(publicationId) {
    assertId(publicationId);
    try {
      return JSON.parse(await readFile(this.#path(publicationId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async findByIdempotencyKey(idempotencyKey) {
    const records = await this.list();
    return records.find((record) => record.idempotencyKey === idempotencyKey) || null;
  }

  async save(record) {
    assertId(record?.id);
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

    return record;
  }

  #directory() {
    return path.join(getStorageRoot(), "publications");
  }

  #path(publicationId) {
    return path.join(this.#directory(), `${publicationId}.json`);
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
