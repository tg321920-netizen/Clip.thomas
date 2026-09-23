import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class AIUsageService {
  async record(input = {}) {
    const provider = clean(input.provider, 80);
    const model = clean(input.model, 120);
    const operation = clean(input.operation, 80);
    if (!provider || !model || !operation) {
      throw new Error("AI usage requires provider, model and operation.");
    }

    const projectId = input.projectId || null;
    if (projectId !== null && !isProjectId(projectId)) {
      throw new Error("Invalid AI usage projectId.");
    }

    const inputTokens = tokenCount(input.inputTokens, "inputTokens");
    const outputTokens = tokenCount(input.outputTokens, "outputTokens");
    const externalRequestId = clean(input.externalRequestId, 160) || null;

    if (externalRequestId) {
      const existing = await this.findByExternalRequestId(externalRequestId);
      if (existing) return { record: existing, reused: true };
    }

    const estimatedCostUsd = estimateCostUsd({
      inputTokens,
      outputTokens,
      inputRatePerMillion:
        input.inputRatePerMillion ?? envRate("CLIPFORGE_AI_INPUT_COST_PER_MILLION"),
      outputRatePerMillion:
        input.outputRatePerMillion ?? envRate("CLIPFORGE_AI_OUTPUT_COST_PER_MILLION"),
    });

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
      externalRequestId,
      createdAt: new Date().toISOString(),
    };

    await this.#save(record);
    return { record, reused: false };
  }

  async recordOpenAIResponse({ body, model, operation, projectId = null }) {
    const usage = body?.usage;
    if (!usage || typeof usage !== "object") return null;

    return this.record({
      provider: "openai",
      model,
      operation,
      projectId,
      externalRequestId: typeof body?.id === "string" ? body.id : null,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    });
  }

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
      .filter((row) => !filters.projectId || row.projectId === filters.projectId)
      .filter((row) => !filters.operation || row.operation === filters.operation)
      .filter((row) => !filters.provider || row.provider === filters.provider)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async findByExternalRequestId(value) {
    const id = clean(value, 160);
    if (!id) return null;
    return (await this.list()).find((row) => row.externalRequestId === id) || null;
  }

  async summary(filters = {}) {
    const rows = await this.list(filters);
    return rows.reduce(
      (summary, row) => {
        summary.requests += 1;
        summary.inputTokens += Number(row.inputTokens || 0);
        summary.outputTokens += Number(row.outputTokens || 0);
        summary.totalTokens += Number(row.totalTokens || 0);
        if (typeof row.estimatedCostUsd === "number") {
          summary.knownEstimatedCostUsd += row.estimatedCostUsd;
        } else {
          summary.unknownCostRequests += 1;
        }
        return summary;
      },
      {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        knownEstimatedCostUsd: 0,
        unknownCostRequests: 0,
      },
    );
  }

  async #save(record) {
    const directory = this.#directory();
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

  #directory() {
    return path.join(getStorageRoot(), "ai-usage");
  }
}

export function estimateCostUsd({
  inputTokens,
  outputTokens,
  inputRatePerMillion,
  outputRatePerMillion,
}) {
  if (
    !Number.isFinite(Number(inputRatePerMillion)) ||
    !Number.isFinite(Number(outputRatePerMillion)) ||
    Number(inputRatePerMillion) < 0 ||
    Number(outputRatePerMillion) < 0
  ) {
    return null;
  }

  const cost =
    (Number(inputTokens) / 1_000_000) * Number(inputRatePerMillion) +
    (Number(outputTokens) / 1_000_000) * Number(outputRatePerMillion);
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function tokenCount(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid AI usage ${name}.`);
  }
  return number;
}

function envRate(name) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clean(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
