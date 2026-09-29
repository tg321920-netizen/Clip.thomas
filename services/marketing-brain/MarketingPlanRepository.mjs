import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class MarketingPlanRepository {
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
        if (filters.projectId && record.projectId !== filters.projectId) return false;
        if (filters.objective && record.objective !== filters.objective) return false;
        if (filters.mode && record.mode !== filters.mode) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(planId) {
    assertId(planId, "marketing plan");
    try {
      return JSON.parse(await readFile(this.#path(planId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(plan) {
    assertId(plan?.id, "marketing plan");
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = this.#path(plan.id);
    const temp = path.join(directory, `.${plan.id}.${process.pid}.${Date.now()}.tmp`);

    await writeFile(temp, JSON.stringify(plan, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    return plan;
  }

  #directory() {
    return path.join(getStorageRoot(), "marketing-brain", "plans");
  }

  #path(planId) {
    return path.join(this.#directory(), `${planId}.json`);
  }
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
