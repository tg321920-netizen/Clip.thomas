import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class AgentExecutionRepository {
  async get(id) {
    assertId(id);
    try {
      return JSON.parse(await readFile(this.#path(id), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(filters = {}) {
    await mkdir(this.#directory(), { recursive: true });
    const names = await readdir(this.#directory());
    const statuses = filters.status
      ? new Set(Array.isArray(filters.status) ? filters.status : [filters.status])
      : null;

    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(this.#directory(), name), "utf8"));
        } catch {
          return null;
        }
      }),
    );

    return records
      .filter(Boolean)
      .filter((record) => !statuses || statuses.has(record.status))
      .filter((record) => !filters.channelId || record.task?.channelId === filters.channelId)
      .filter((record) => !filters.workflowId || record.task?.workflowId === filters.workflowId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async save(record) {
    assertId(record?.id);
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
    return record;
  }

  #directory() {
    return path.join(getStorageRoot(), "agent", "executions");
  }

  #path(id) {
    return path.join(this.#directory(), `${id}.json`);
  }
}

function assertId(value) {
  if (!isProjectId(String(value || ""))) throw new Error("Invalid agent execution id.");
}
