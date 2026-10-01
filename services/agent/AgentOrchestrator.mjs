import { randomUUID } from "node:crypto";
import {
  normalizeAgentDecision,
  normalizeAgentTask,
  sanitizeAgentValue,
} from "./AgentContracts.mjs";
import { AgentExecutionRepository } from "./AgentExecutionRepository.mjs";
import { AgentProviderError } from "./AgentProvider.mjs";
import { evaluateAgentToolPolicy } from "./AutonomyPolicy.mjs";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const PAUSED = new Set(["WAITING_INFORMATION", "WAITING_APPROVAL"]);

export class AgentOrchestrator {
  constructor(options = {}) {
    if (!options.provider) throw new Error("Agent provider is required.");
    if (!options.tools) throw new Error("Agent tool registry is required.");
    this.provider = options.provider;
    this.tools = options.tools;
    this.repository = options.repository || new AgentExecutionRepository();
    this.now = options.now || (() => new Date());
  }

  async createTask(input = {}) {
    const task = normalizeAgentTask(input);
    const now = this.#nowIso();
    const execution = {
      id: randomUUID(),
      task,
      status: "QUEUED",
      stepCount: 0,
      retryCount: 0,
      nextAttemptAt: null,
      pendingDecision: null,
      approvedDecision: null,
      results: [],
      error: null,
      history: [event(now, "execution_created", { trigger: task.trigger })],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await this.repository.save(execution);
    return execution;
  }

  async get(id) {
    return this.repository.get(id);
  }

  async list(filters = {}) {
    return this.repository.list(filters);
  }

  async run(id) {
    let execution = await this.#require(id);
    if (TERMINAL.has(execution.status) || PAUSED.has(execution.status)) return execution;

    if (execution.status === "WAITING_RETRY") {
      const due = Date.parse(execution.nextAttemptAt || "");
      if (Number.isFinite(due) && due > this.#nowMs()) return execution;
      execution = await this.#save({
        ...execution,
        status: "QUEUED",
        nextAttemptAt: null,
        updatedAt: this.#nowIso(),
      });
    }

    const runStartedAt = this.#nowMs();
    while (execution.stepCount < execution.task.limits.maxSteps) {
      if (this.#nowMs() - runStartedAt >= execution.task.limits.timeoutMs) {
        return this.#fail(execution, "AGENT_TIMEOUT", "Agent execution timed out.");
      }

      execution = await this.#save({
        ...execution,
        status: "RUNNING",
        updatedAt: this.#nowIso(),
      });

      let decision = execution.approvedDecision;
      const approved = Boolean(decision);
      if (!decision) {
        try {
          decision = normalizeAgentDecision(
            await this.provider.decide(execution.task, this.#providerContext(execution)),
          );
        } catch (error) {
          return this.#handleFailure(execution, error, "provider");
        }
      }

      if (decision.type === "COMPLETE") {
        return this.#save({
          ...execution,
          status: "COMPLETED",
          error: null,
          pendingDecision: null,
          approvedDecision: null,
          history: append(execution, "execution_completed", {
            output: sanitizeAgentValue(decision.output),
          }, this.#nowIso()),
          updatedAt: this.#nowIso(),
          completedAt: this.#nowIso(),
        });
      }

      if (decision.type === "WAITING_INFORMATION") {
        return this.#pause(execution, "WAITING_INFORMATION", decision.reason, decision);
      }

      if (decision.type === "WAITING_APPROVAL") {
        return this.#pause(execution, "WAITING_APPROVAL", decision.reason, decision);
      }

      const policy = approved
        ? { allowed: true, requiresApproval: false, reason: null }
        : evaluateAgentToolPolicy({
            autonomyMode: execution.task.autonomyMode,
            toolName: decision.tool,
          });

      if (policy.requiresApproval) {
        return this.#save({
          ...execution,
          status: "WAITING_APPROVAL",
          pendingDecision: decision,
          approvedDecision: null,
          history: append(execution, "tool_waiting_approval", {
            tool: decision.tool,
            reason: policy.reason,
          }, this.#nowIso()),
          updatedAt: this.#nowIso(),
        });
      }

      if (!policy.allowed) {
        return this.#save({
          ...execution,
          status: "WAITING_INFORMATION",
          pendingDecision: decision,
          approvedDecision: null,
          error: policy.reason,
          history: append(execution, "tool_blocked", {
            tool: decision.tool,
            code: policy.code || "AGENT_TOOL_POLICY_BLOCKED",
            reason: policy.reason,
          }, this.#nowIso()),
          updatedAt: this.#nowIso(),
        });
      }

      try {
        const result = await this.tools.execute(decision.tool, decision.input, {
          executionId: execution.id,
          task: execution.task,
          autonomyMode: execution.task.autonomyMode,
        });
        const now = this.#nowIso();
        execution = await this.#save({
          ...execution,
          status: "QUEUED",
          stepCount: execution.stepCount + 1,
          retryCount: 0,
          pendingDecision: null,
          approvedDecision: null,
          nextAttemptAt: null,
          error: null,
          results: [
            ...execution.results,
            {
              step: execution.stepCount + 1,
              tool: decision.tool,
              input: sanitizeAgentValue(decision.input),
              result: sanitizeAgentValue(result),
              at: now,
            },
          ].slice(-100),
          history: append(execution, "tool_completed", {
            tool: decision.tool,
            step: execution.stepCount + 1,
          }, now),
          updatedAt: now,
        });
      } catch (error) {
        execution = await this.#handleFailure(execution, error, decision.tool);
        if (execution.status !== "QUEUED") return execution;
      }
    }

    return this.#fail(
      execution,
      "AGENT_MAX_STEPS_EXCEEDED",
      "Agent execution reached maxSteps.",
    );
  }

  async approve(id) {
    const execution = await this.#require(id);
    if (execution.status !== "WAITING_APPROVAL" || !execution.pendingDecision) {
      throw new Error("Agent execution is not waiting for approval.");
    }
    const now = this.#nowIso();
    return this.#save({
      ...execution,
      status: "QUEUED",
      approvedDecision: execution.pendingDecision,
      pendingDecision: null,
      error: null,
      history: append(execution, "approval_granted", {
        tool: execution.pendingDecision.tool || null,
      }, now),
      updatedAt: now,
    });
  }

  async provideInformation(id, context = {}) {
    const execution = await this.#require(id);
    if (execution.status !== "WAITING_INFORMATION") {
      throw new Error("Agent execution is not waiting for information.");
    }
    const now = this.#nowIso();
    return this.#save({
      ...execution,
      task: {
        ...execution.task,
        context: {
          ...execution.task.context,
          ...sanitizeAgentValue(context),
        },
      },
      status: "QUEUED",
      pendingDecision: null,
      error: null,
      history: append(execution, "information_received", {}, now),
      updatedAt: now,
    });
  }

  async cancel(id, reason = "Cancelled by operator.") {
    const execution = await this.#require(id);
    if (TERMINAL.has(execution.status)) return execution;
    const now = this.#nowIso();
    return this.#save({
      ...execution,
      status: "CANCELLED",
      error: String(reason).slice(0, 1000),
      history: append(execution, "execution_cancelled", { reason }, now),
      updatedAt: now,
      completedAt: now,
    });
  }

  #providerContext(execution) {
    return sanitizeAgentValue({
      executionId: execution.id,
      autonomyMode: execution.task.autonomyMode,
      stepCount: execution.stepCount,
      remainingSteps: Math.max(0, execution.task.limits.maxSteps - execution.stepCount),
      results: execution.results.slice(-12),
      tools: this.tools.listDefinitions(),
    });
  }

  async #handleFailure(execution, error, source) {
    const retryable = error?.retryable === true;
    const waitingInformation =
      error instanceof AgentProviderError && error.waitingInformation === true;
    const message = error instanceof Error ? error.message : String(error);
    const code = String(error?.code || "AGENT_EXECUTION_ERROR");

    if (waitingInformation) {
      const now = this.#nowIso();
      return this.#save({
        ...execution,
        status: "WAITING_INFORMATION",
        error: message,
        history: append(execution, "waiting_information", { source, code, message }, now),
        updatedAt: now,
      });
    }

    if (retryable && execution.retryCount < execution.task.limits.maxRetries) {
      const retryCount = execution.retryCount + 1;
      const delay = Math.min(
        execution.task.limits.baseBackoffMs * (2 ** (retryCount - 1)),
        5 * 60_000,
      );
      const nextAttemptAt = new Date(this.#nowMs() + delay).toISOString();
      const now = this.#nowIso();
      return this.#save({
        ...execution,
        status: "WAITING_RETRY",
        retryCount,
        nextAttemptAt,
        error: message,
        history: append(execution, "retry_scheduled", {
          source,
          code,
          message,
          retryCount,
          nextAttemptAt,
        }, now),
        updatedAt: now,
      });
    }

    if (source === "provider") {
      const now = this.#nowIso();
      return this.#save({
        ...execution,
        status: "WAITING_INFORMATION",
        error: message,
        history: append(execution, "provider_fallback_wait", {
          code,
          message,
          reason: "The model provider could not produce a safe decision.",
        }, now),
        updatedAt: now,
      });
    }

    return this.#fail(execution, code, message, source);
  }

  async #pause(execution, status, reason, decision) {
    const now = this.#nowIso();
    return this.#save({
      ...execution,
      status,
      pendingDecision: decision,
      error: reason || null,
      history: append(execution, status.toLowerCase(), {
        reason: reason || null,
      }, now),
      updatedAt: now,
    });
  }

  async #fail(execution, code, message, source = null) {
    const now = this.#nowIso();
    return this.#save({
      ...execution,
      status: "FAILED",
      error: message,
      pendingDecision: null,
      approvedDecision: null,
      history: append(execution, "execution_failed", { code, message, source }, now),
      updatedAt: now,
      completedAt: now,
    });
  }

  async #require(id) {
    const execution = await this.repository.get(id);
    if (!execution) throw new Error("Agent execution not found.");
    return execution;
  }

  async #save(execution) {
    await this.repository.save(execution);
    return execution;
  }

  #nowMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value);
  }

  #nowIso() {
    return new Date(this.#nowMs()).toISOString();
  }
}

function event(at, type, data) {
  return { at, type, data: sanitizeAgentValue(data) };
}

function append(execution, type, data, at) {
  return [...(execution.history || []), event(at, type, data)].slice(-300);
}
