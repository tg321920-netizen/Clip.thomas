import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class ApprovalRepository {
  async list(filters = {}) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => {
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
        if (filters.status) {
          const allowed = Array.isArray(filters.status) ? filters.status : [filters.status];
          if (!allowed.includes(record.status)) return false;
        }
        if (filters.subjectType && record.subjectType !== filters.subjectType) return false;
        if (filters.subjectId && record.subjectId !== filters.subjectId) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(approvalId) {
    assertId(approvalId, "approval");
    try {
      return JSON.parse(await readFile(this.#path(approvalId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async findPendingBySubject(subjectType, subjectId) {
    const records = await this.list({ status: "PENDING", subjectType, subjectId });
    return records[0] || null;
  }

  async save(record) {
    assertId(record?.id, "approval");
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
    return path.join(getStorageRoot(), "approvals");
  }

  #path(approvalId) {
    return path.join(this.#directory(), `${approvalId}.json`);
  }
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
