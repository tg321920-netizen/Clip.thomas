import { isProjectId } from "../../lib/project-id.mjs";

export const AUTONOMY_MODES = new Set(["MANUAL", "SEMI_AUTO", "AUTO"]);
export const AGENT_DECISION_TYPES = new Set([
  "TOOL",
  "COMPLETE",
  "WAITING_INFORMATION",
  "WAITING_APPROVAL",
]);
export const AGENT_EXECUTION_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "WAITING_RETRY",
  "WAITING_INFORMATION",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const TRIGGERS = new Set([
  "MANUAL",
  "CRON",
  "INTERNAL_EVENT",
  "CONTENT_READY",
  "TREND_DETECTED",
  "PUBLICATION_COMPLETED",
  "PUBLICATION_FAILED",
  "ANALYTICS_RECEIVED",
]);

export function normalizeAutonomyMode(value, fallback = "MANUAL") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "AUTOPILOT") return "AUTO";
  if (AUTONOMY_MODES.has(normalized)) return normalized;
  return AUTONOMY_MODES.has(fallback) ? fallback : "MANUAL";
}

export function normalizeAgentTask(input = {}) {
  const objective = cleanText(input.objective, 1200);
  if (!objective) throw new Error("Agent task objective is required.");

  return {
    objective,
    trigger: normalizeTrigger(input.trigger),
    autonomyMode: normalizeAutonomyMode(input.autonomyMode),
    workflowId: normalizeOptionalId(input.workflowId, "workflow"),
    workflowExecutionId: normalizeOptionalId(input.workflowExecutionId, "workflow execution"),
    projectId: normalizeOptionalId(input.projectId, "project"),
    channelId: normalizeOptionalId(input.channelId, "channel"),
    context: sanitizeObject(input.context),
    limits: normalizeAgentLimits(input.limits),
  };
}

export function normalizeAgentLimits(input = {}) {
  return {
    maxSteps: boundedInteger(input.maxSteps, 1, 50, 12),
    maxRetries: boundedInteger(input.maxRetries, 0, 5, 2),
    timeoutMs: boundedInteger(input.timeoutMs, 5_000, 15 * 60_000, 120_000),
    baseBackoffMs: boundedInteger(input.baseBackoffMs, 1_000, 5 * 60_000, 5_000),
  };
}

export function normalizeAgentDecision(input = {}) {
  const type = String(input.type || "").trim().toUpperCase();
  if (!AGENT_DECISION_TYPES.has(type)) {
    throw new Error("Agent decision type is invalid.");
  }

  const decision = {
    type,
    tool: null,
    input: sanitizeObject(input.input),
    rationale: cleanText(input.rationale, 1000) || null,
    output: sanitizeObject(input.output),
    reason: cleanText(input.reason, 1000) || null,
  };

  if (type === "TOOL") {
    const tool = String(input.tool || "").trim();
    if (!/^[a-z][a-z0-9.-]{1,80}$/i.test(tool)) {
      throw new Error("Agent TOOL decision requires a valid tool name.");
    }
    decision.tool = tool;
  }

  if ((type === "WAITING_INFORMATION" || type === "WAITING_APPROVAL") && !decision.reason) {
    decision.reason = type === "WAITING_APPROVAL"
      ? "Human approval is required before continuing."
      : "More information is required before continuing.";
  }

  return decision;
}

export function sanitizeAgentValue(value) {
  return stripSensitiveKeys(sanitizeValue(value));
}

function stripSensitiveKeys(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveKeys);
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|api.?key|client.?secret|credential/i.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = stripSensitiveKeys(item);
  }
  return output;
}

function normalizeTrigger(value) {
  const normalized = String(value || "MANUAL").trim().toUpperCase();
  if (!TRIGGERS.has(normalized)) throw new Error("Unsupported agent trigger.");
  return normalized;
}

function normalizeOptionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!isProjectId(normalized)) throw new Error(`Invalid ${label} id.`);
  return normalized;
}

function sanitizeObject(value) {
  const sanitized = sanitizeValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

function sanitizeValue(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("Agent data must be JSON serializable.");
  }
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}
