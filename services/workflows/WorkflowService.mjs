import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { WorkflowRepository } from "./WorkflowRepository.mjs";

export const EXECUTION_STATUSES = new Set([
  "draft",
  "queued",
  "processing",
  "waiting_approval",
  "waiting_information",
  "approved",
  "publishing",
  "completed",
  "failed",
  "cancelled",
]);

const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const STEP_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export class WorkflowService {
  constructor(options = {}) {
    this.repository = options.repository || new WorkflowRepository();
  }

  async listWorkflows(filters = {}) {
    return this.repository.listWorkflows(filters);
  }

  async getWorkflow(workflowId) {
    return this.repository.getWorkflow(workflowId);
  }

  async createWorkflow(input = {}) {
    const name = cleanText(input.name, 120);
    if (!name) throw new Error("Workflow name is required.");

    const projectId = normalizeOptionalProjectId(input.projectId);
    const steps = normalizeSteps(input.steps);
    const now = new Date().toISOString();
    const workflow = {
      id: randomUUID(),
      name,
      description: cleanText(input.description, 500) || null,
      projectId,
      version: 1,
      enabled: input.enabled !== false,
      steps,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.saveWorkflow(workflow);
    return workflow;
  }

  async listExecutions(filters = {}) {
    return this.repository.listExecutions(filters);
  }

  async getExecution(executionId) {
    return this.repository.getExecution(executionId);
  }

  async createExecution(workflowId, input = {}) {
    assertUuid(workflowId, "workflow");
    const workflow = await this.repository.getWorkflow(workflowId);
    if (!workflow) throw new Error("Workflow not found.");
    if (!workflow.enabled) throw new Error("Workflow is disabled.");

    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    if (idempotencyKey) {
      const existing = await this.repository.findExecutionByIdempotencyKey(idempotencyKey);
      if (existing) return { execution: existing, reused: true };
    }

    const projectId = normalizeOptionalProjectId(input.projectId ?? workflow.projectId);
    const now = new Date().toISOString();
    const execution = {
      id: randomUUID(),
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      projectId,
      idempotencyKey,
      status: "queued",
      currentStepIndex: 0,
      currentStepId: workflow.steps[0].id,
      input: sanitizeObject(input.input),
      results: {},
      error: null,
      retries: 0,
      steps: workflow.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? "queued" : "pending",
        attempts: 0,
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })),
      history: [historyEvent("execution_created", workflow.steps[0].id, {})],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    await this.repository.saveExecution(execution);
    return { execution, reused: false };
  }

  async startCurrentStep(executionId) {
    const execution = await this.#requiredExecution(executionId);
    assertMutable(execution);
    const step = currentStep(execution);
    if (!step) return execution;

    if (!["queued", "pending"].includes(step.status)) {
      throw new Error(`Current step cannot start from status ${step.status}.`);
    }

    const now = new Date().toISOString();
    const attempts = Number(step.attempts || 0) + 1;
    if (attempts > Number(step.maxAttempts || 1)) {
      throw new Error("Current step has exhausted its retry limit.");
    }

    if (step.requiresApproval || step.type === "APPROVAL") {
      return this.#save({
        ...execution,
        status: "waiting_approval",
        steps: replaceStep(execution.steps, step.id, {
          ...step,
          status: "waiting_approval",
          attempts,
          startedAt: step.startedAt || now,
          error: null,
        }),
        history: appendHistory(
          execution,
          "approval_requested",
          step.id,
          {},
        ),
        updatedAt: now,
        error: null,
      });
    }

    return this.#save({
      ...execution,
      status: step.type === "PUBLISH" ? "publishing" : "processing",
      steps: replaceStep(execution.steps, step.id, {
        ...step,
        status: "processing",
        attempts,
        startedAt: step.startedAt || now,
        error: null,
      }),
      history: appendHistory(execution, "step_started", step.id, { attempts }),
      updatedAt: now,
      error: null,
    });
  }

  async completeCurrentStep(executionId, output = {}) {
    const execution = await this.#requiredExecution(executionId);
    assertMutable(execution);
    const step = currentStep(execution);
    if (!step) throw new Error("Execution has no current step.");
    if (step.status !== "processing") {
      throw new Error("Only a processing step can be completed.");
    }

    return this.#completeStep(execution, step, output, "step_completed");
  }

  async failCurrentStep(executionId, error, options = {}) {
    const execution = await this.#requiredExecution(executionId);
    assertMutable(execution);
    const step = currentStep(execution);
    if (!step) throw new Error("Execution has no current step.");
    if (step.status !== "processing") {
      throw new Error("Only a processing step can fail.");
    }

    const message = cleanText(error instanceof Error ? error.message : error, 1000) || "Step failed.";
    const retryable = options.retryable !== false;
    const canRetry = retryable && Number(step.attempts || 0) < Number(step.maxAttempts || 1);
    const now = new Date().toISOString();
    const nextStep = {
      ...step,
      status: canRetry ? "queued" : "failed",
      error: message,
    };

    return this.#save({
      ...execution,
      status: canRetry ? "queued" : "failed",
      error: message,
      retries: Number(execution.retries || 0) + (canRetry ? 1 : 0),
      steps: replaceStep(execution.steps, step.id, nextStep),
      history: appendHistory(execution, canRetry ? "step_retry_queued" : "step_failed", step.id, {
        error: message,
        retryable,
      }),
      updatedAt: now,
      completedAt: canRetry ? null : now,
    });
  }

  async waitForInformation(executionId, details = {}) {
    const execution = await this.#requiredExecution(executionId);
    assertMutable(execution);
    const step = currentStep(execution);
    if (!step) throw new Error("Execution has no current step.");
    if (!["processing", "queued"].includes(step.status)) {
      throw new Error("Current step cannot wait for information from its current status.");
    }

    const now = new Date().toISOString();
    return this.#save({
      ...execution,
      status: "waiting_information",
      steps: replaceStep(execution.steps, step.id, {
        ...step,
        status: "waiting_information",
      }),
      history: appendHistory(execution, "information_requested", step.id, sanitizeObject(details)),
      updatedAt: now,
    });
  }

  async resumeExecution(executionId) {
    const execution = await this.#requiredExecution(executionId);
    if (!["waiting_information", "failed"].includes(execution.status)) {
      throw new Error("Only waiting_information or failed executions can be resumed.");
    }

    const step = currentStep(execution);
    if (!step) throw new Error("Execution has no current step.");
    const now = new Date().toISOString();
    const resetAttempts = execution.status === "failed";

    return this.#save({
      ...execution,
      status: "queued",
      error: null,
      completedAt: null,
      steps: replaceStep(execution.steps, step.id, {
        ...step,
        status: "queued",
        attempts: resetAttempts ? 0 : step.attempts,
        error: null,
      }),
      history: appendHistory(execution, "execution_resumed", step.id, {
        attemptsReset: resetAttempts,
      }),
      updatedAt: now,
    });
  }

  async approveExecution(executionId, details = {}) {
    const execution = await this.#requiredExecution(executionId);
    if (execution.status !== "waiting_approval") {
      throw new Error("Execution is not waiting for approval.");
    }
    const step = currentStep(execution);
    if (!step || step.status !== "waiting_approval") {
      throw new Error("Current step is not waiting for approval.");
    }

    return this.#completeStep(
      execution,
      step,
      { approved: true, ...sanitizeObject(details) },
      "approval_granted",
    );
  }

  async cancelExecution(executionId, details = {}) {
    const execution = await this.#requiredExecution(executionId);
    if (["completed", "cancelled"].includes(execution.status)) return execution;
    const step = currentStep(execution);
    const now = new Date().toISOString();

    return this.#save({
      ...execution,
      status: "cancelled",
      steps: step
        ? replaceStep(execution.steps, step.id, { ...step, status: "cancelled" })
        : execution.steps,
      history: appendHistory(execution, "execution_cancelled", step?.id || null, sanitizeObject(details)),
      updatedAt: now,
      completedAt: now,
    });
  }

  async #completeStep(execution, step, output, eventType) {
    const now = new Date().toISOString();
    const normalizedOutput = sanitizeValue(output);
    const completedStep = {
      ...step,
      status: "completed",
      output: normalizedOutput,
      error: null,
      completedAt: now,
    };
    const steps = replaceStep(execution.steps, step.id, completedStep);
    const nextIndex = Number(execution.currentStepIndex) + 1;
    const nextStep = steps[nextIndex] || null;

    if (!nextStep) {
      return this.#save({
        ...execution,
        status: "completed",
        currentStepIndex: null,
        currentStepId: null,
        results: { ...execution.results, [step.id]: normalizedOutput },
        error: null,
        steps,
        history: appendHistory(execution, eventType, step.id, {}),
        updatedAt: now,
        completedAt: now,
      });
    }

    const queuedNext = { ...nextStep, status: "queued" };
    const advancedSteps = replaceStep(steps, nextStep.id, queuedNext);
    return this.#save({
      ...execution,
      status: "queued",
      currentStepIndex: nextIndex,
      currentStepId: nextStep.id,
      results: { ...execution.results, [step.id]: normalizedOutput },
      error: null,
      steps: advancedSteps,
      history: [
        ...appendHistory(execution, eventType, step.id, {}),
        historyEvent("step_queued", nextStep.id, {}),
      ],
      updatedAt: now,
      completedAt: null,
    });
  }

  async #requiredExecution(executionId) {
    assertUuid(executionId, "execution");
    const execution = await this.repository.getExecution(executionId);
    if (!execution) throw new Error("Execution not found.");
    return execution;
  }

  async #save(execution) {
    await this.repository.saveExecution(execution);
    return execution;
  }
}

export function normalizeSteps(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Workflow requires at least one step.");
  }
  if (input.length > 100) throw new Error("Workflow cannot exceed 100 steps.");

  const seen = new Set();
  return input.map((raw, index) => {
    const type = String(raw?.type || "").trim().toUpperCase();
    if (!STEP_TYPE_PATTERN.test(type)) {
      throw new Error(`Invalid workflow step type at position ${index + 1}.`);
    }

    const fallbackId = `${type.toLowerCase().replaceAll("_", "-")}-${index + 1}`;
    const id = String(raw?.id || fallbackId).trim();
    if (!STEP_ID_PATTERN.test(id) || seen.has(id)) {
      throw new Error(`Invalid or duplicate workflow step id: ${id}.`);
    }
    seen.add(id);

    const maxAttempts = clampInteger(raw?.maxAttempts, 1, 10, 3);
    return {
      id,
      type,
      name: cleanText(raw?.name, 120) || titleFromType(type),
      config: sanitizeObject(raw?.config),
      requiresApproval: raw?.requiresApproval === true || type === "APPROVAL",
      maxAttempts,
    };
  });
}

function currentStep(execution) {
  if (!Number.isInteger(execution.currentStepIndex)) return null;
  return execution.steps[execution.currentStepIndex] || null;
}

function replaceStep(steps, stepId, replacement) {
  return steps.map((step) => (step.id === stepId ? replacement : step));
}

function appendHistory(execution, type, stepId, data) {
  return [...(execution.history || []), historyEvent(type, stepId, data)];
}

function historyEvent(type, stepId, data) {
  return {
    at: new Date().toISOString(),
    type,
    stepId,
    data: sanitizeObject(data),
  };
}

function assertMutable(execution) {
  if (["completed", "cancelled"].includes(execution.status)) {
    throw new Error(`Execution is ${execution.status}.`);
  }
}

function normalizeOptionalProjectId(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!isProjectId(normalized)) throw new Error("Invalid project id.");
  return normalized;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 200) {
    throw new Error("Invalid idempotency key.");
  }
  return normalized;
}

function assertUuid(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function titleFromType(type) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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
    throw new Error("Workflow data must be JSON serializable.");
  }
}
