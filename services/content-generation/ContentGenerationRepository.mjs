import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class ContentGenerationRepository {
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
      .filter((record) => {
        if (filters.planId && record.planId !== filters.planId) return false;
        if (filters.projectId && record.projectId !== filters.projectId) return false;
        if (filters.status && record.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(generationId) {
    assertId(generationId, "content generation");
    try {
      return JSON.parse(await readFile(this.#path(generationId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(record) {
    assertId(record?.id, "content generation");
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

  #directory() {
    return path.join(getStorageRoot(), "content-generation", "records");
  }

  #path(generationId) {
    return path.join(this.#directory(), `${generationId}.json`);
  }
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
