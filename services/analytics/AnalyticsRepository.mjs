import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class AnalyticsRepository {
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
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  }

  async get(snapshotId) {
    assertId(snapshotId, "analytics snapshot");
    try {
      return JSON.parse(await readFile(this.#path(snapshotId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(record) {
    assertId(record?.id, "analytics snapshot");
    assertId(record?.publicationId, "publication");

    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = this.#path(record.id);
    const temp = path.join(directory, `.${record.id}.${process.pid}.${Date.now()}.tmp`);

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

  async latestByPublication(publicationId) {
    assertId(publicationId, "publication");
    const records = await this.list({ publicationId });
    return records.at(-1) || null;
  }

  #directory() {
    return path.join(getStorageRoot(), "analytics");
  }

  #path(snapshotId) {
    return path.join(this.#directory(), `${snapshotId}.json`);
  }
}

function matches(record, filters) {
  if (filters.publicationId && record.publicationId !== filters.publicationId) return false;
  if (filters.channelId && record.channelId !== filters.channelId) return false;
  if (filters.platform && record.platform !== filters.platform) return false;
  if (filters.projectId && record.projectId !== filters.projectId) return false;
  if (filters.clipId && record.clipId !== filters.clipId) return false;
  if (filters.since && Date.parse(record.capturedAt) < Date.parse(filters.since)) return false;
  if (filters.until && Date.parse(record.capturedAt) > Date.parse(filters.until)) return false;
  return true;
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
