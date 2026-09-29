import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class SourceRepository {
  async listSources(filters = {}) {
    return this.#list(this.#sourcesDirectory(), (record) => {
      if (filters.type && record.type !== filters.type) return false;
      if (filters.projectId && record.projectId !== filters.projectId) return false;
      return true;
    });
  }

  async getSource(sourceId) {
    assertId(sourceId, "source");
    return this.#read(this.#sourcePath(sourceId));
  }

  async saveSource(source) {
    assertId(source?.id, "source");
    return this.#write(this.#sourcesDirectory(), this.#sourcePath(source.id), source);
  }

  async listExtractions(filters = {}) {
    return this.#list(this.#extractionsDirectory(), (record) => {
      if (filters.sourceId && record.sourceId !== filters.sourceId) return false;
      if (filters.projectId && record.projectId !== filters.projectId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  async getExtraction(extractionId) {
    assertId(extractionId, "extraction");
    return this.#read(this.#extractionPath(extractionId));
  }

  async saveExtraction(extraction) {
    assertId(extraction?.id, "extraction");
    return this.#write(
      this.#extractionsDirectory(),
      this.#extractionPath(extraction.id),
      extraction,
    );
  }

  async #list(directory, predicate) {
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
      .filter(predicate)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async #read(target) {
    try {
      return JSON.parse(await readFile(target, "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #write(directory, target, record) {
    await mkdir(directory, { recursive: true });
    const temp = path.join(
      directory,
      `.${path.basename(target, ".json")}.${process.pid}.${Date.now()}.tmp`,
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

  #root() {
    return path.join(getStorageRoot(), "marketing-sources");
  }

  #sourcesDirectory() {
    return path.join(this.#root(), "sources");
  }

  #extractionsDirectory() {
    return path.join(this.#root(), "extractions");
  }

  #sourcePath(sourceId) {
    return path.join(this.#sourcesDirectory(), `${sourceId}.json`);
  }

  #extractionPath(extractionId) {
    return path.join(this.#extractionsDirectory(), `${extractionId}.json`);
  }
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
