import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class WorkflowRepository {
  async listWorkflows(filters = {}) {
    return this.#list(this.#workflowsDirectory(), (record) => {
      if (filters.projectId && record.projectId !== filters.projectId) return false;
      if (typeof filters.enabled === "boolean" && record.enabled !== filters.enabled) {
        return false;
      }
      return true;
    });
  }

  async getWorkflow(workflowId) {
    assertId(workflowId, "workflow");
    return this.#read(this.#workflowPath(workflowId));
  }

  async saveWorkflow(workflow) {
    assertId(workflow?.id, "workflow");
    return this.#write(this.#workflowsDirectory(), this.#workflowPath(workflow.id), workflow);
  }

  async listExecutions(filters = {}) {
    return this.#list(this.#executionsDirectory(), (record) => {
      if (filters.workflowId && record.workflowId !== filters.workflowId) return false;
      if (filters.projectId && record.projectId !== filters.projectId) return false;
      if (filters.status) {
        const allowed = Array.isArray(filters.status) ? filters.status : [filters.status];
        if (!allowed.includes(record.status)) return false;
      }
      return true;
    });
  }

  async getExecution(executionId) {
    assertId(executionId, "execution");
    return this.#read(this.#executionPath(executionId));
  }

  async findExecutionByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const executions = await this.listExecutions();
    return executions.find((record) => record.idempotencyKey === idempotencyKey) || null;
  }

  async saveExecution(execution) {
    assertId(execution?.id, "execution");
    return this.#write(
      this.#executionsDirectory(),
      this.#executionPath(execution.id),
      execution,
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
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
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
    return path.join(getStorageRoot(), "workflows");
  }

  #workflowsDirectory() {
    return path.join(this.#root(), "definitions");
  }

  #executionsDirectory() {
    return path.join(this.#root(), "executions");
  }

  #workflowPath(workflowId) {
    return path.join(this.#workflowsDirectory(), `${workflowId}.json`);
  }

  #executionPath(executionId) {
    return path.join(this.#executionsDirectory(), `${executionId}.json`);
  }
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
