import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class AIUsageService {
  async record(input = {}) {
    const operation = cleanRequired(input.operation, "operation", 100);
    const provider = cleanRequired(input.provider, "provider", 80);
    const model = cleanRequired(input.model, "model", 120);
    const projectId = input.projectId || null;
    if (projectId !== null && !isProjectId(projectId)) {
      throw new Error("Invalid project id.");
    }

    const inputTokens = nonNegativeInteger(input.inputTokens, "inputTokens");
    const outputTokens = nonNegativeInteger(input.outputTokens, "outputTokens");
    const estimatedCostUsd = optionalNonNegativeNumber(
      input.estimatedCostUsd,
      "estimatedCostUsd",
    );
    const createdAt = normalizeDate(input.createdAt || new Date().toISOString());

    const record = {
      id: randomUUID(),
      provider,
      model,
      operation,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd,
      projectId,
      createdAt,
    };

    await save(record);
    return record;
  }

  async list(filters = {}) {
    const records = await listAll();
    return records.filter((record) => matches(record, filters));
  }

  async summarize(filters = {}) {
    const records = await this.list(filters);
    const totals = records.reduce(
      (acc, record) => {
        acc.inputTokens += record.inputTokens || 0;
        acc.outputTokens += record.outputTokens || 0;
        acc.totalTokens += record.totalTokens || 0;
        if (Number.isFinite(record.estimatedCostUsd)) {
          acc.estimatedCostUsd += record.estimatedCostUsd;
          acc.costedRecords += 1;
        }
        return acc;
      },
      {
        records: records.length,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        costedRecords: 0,
      },
    );

    return {
      ...totals,
      costCoverage: records.length > 0 ? totals.costedRecords / records.length : 0,
      note:
        totals.costedRecords < records.length
          ? "El costo solo suma registros que recibieron estimatedCostUsd; ClipForge no inventa precios de modelos."
          : null,
    };
  }
}

async function listAll() {
  const directory = getDirectory();
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
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

async function save(record) {
  const directory = getDirectory();
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${record.id}.json`);
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
}

function matches(record, filters) {
  if (filters.projectId && record.projectId !== filters.projectId) return false;
  if (filters.provider && record.provider !== filters.provider) return false;
  if (filters.model && record.model !== filters.model) return false;
  if (filters.operation && record.operation !== filters.operation) return false;
  if (filters.since && Date.parse(record.createdAt) < Date.parse(filters.since)) return false;
  if (filters.until && Date.parse(record.createdAt) > Date.parse(filters.until)) return false;
  return true;
}

function getDirectory() {
  return path.join(getStorageRoot(), "ai-usage");
}

function cleanRequired(value, label, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, maxLength);
}

function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return number;
}

function optionalNonNegativeNumber(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return number;
}

function normalizeDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("createdAt is invalid.");
  return date.toISOString();
}
