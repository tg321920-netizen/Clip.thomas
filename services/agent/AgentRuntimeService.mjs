import { AgentOrchestrator } from "./AgentOrchestrator.mjs";
import { AgentToolRegistry } from "./AgentToolRegistry.mjs";
import { normalizeAutonomyMode } from "./AgentContracts.mjs";
import { ZaiAgentProvider } from "./providers/ZaiAgentProvider.mjs";
import { resolveAgentRules } from "./AgentRules.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { WorkflowService } from "../workflows/WorkflowService.mjs";

export class AgentRuntimeService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.channels = options.channels || new ChannelService();
    this.workflows = options.workflows || new WorkflowService();
    this.rules = options.rules || resolveAgentRules(this.env);
    this.tools = options.tools || new AgentToolRegistry({ channels: this.channels });
    this.provider = options.provider || new ZaiAgentProvider();
    this.orchestrator = options.orchestrator || new AgentOrchestrator({
      provider: this.provider,
      tools: this.tools,
    });
  }

  isEnabled(env = this.env) {
    return String(env.CLIPFORGE_AGENT_ENABLED || "").trim().toLowerCase() === "true";
  }

  defaultAutonomyMode(env = this.env) {
    return normalizeAutonomyMode(
      env.CLIPFORGE_AGENT_MODE || env.AGENT_MODE || "SEMI_AUTO",
      "SEMI_AUTO",
    );
  }

  async createTask(input = {}) {
    const fallbackMode = this.defaultAutonomyMode();
    const autonomyMode = normalizeAutonomyMode(
      input.autonomyMode || fallbackMode,
      fallbackMode,
    );

    return this.orchestrator.createTask({
      ...input,
      autonomyMode,
      context: {
        ...(input.context || {}),
        agentRules: this.rules,
      },
      limits: {
        ...(input.limits || {}),
        maxRetries: input.limits?.maxRetries ?? this.rules.maxRetries,
      },
    });
  }

  async ensureAutonomousCycle(options = {}) {
    const env = options.env || this.env;
    if (options.requireEnabled !== false && !this.isEnabled(env)) {
      return { enabled: false, created: null, reason: "disabled" };
    }

    const objective = String(env.CLIPFORGE_AGENT_OBJECTIVE || "").trim();
    if (!objective) {
      return { enabled: true, created: null, reason: "objective_not_configured" };
    }

    const executions = await this.orchestrator.list({});
    const active = executions.find((execution) =>
      [
        "QUEUED",
        "RUNNING",
        "WAITING_RETRY",
        "WAITING_INFORMATION",
        "WAITING_APPROVAL",
      ].includes(execution.status),
    );
    if (active) {
      return {
        enabled: true,
        created: null,
        reason: "active_execution",
        activeId: active.id,
      };
    }

    const cycleMs = Math.max(
      60_000,
      Math.min(Number(env.CLIPFORGE_AGENT_CYCLE_MS || 3_600_000), 86_400_000),
    );
    const latest = executions[0] || null;
    if (latest) {
      const lastUpdate = Date.parse(latest.updatedAt || latest.createdAt || "");
      if (Number.isFinite(lastUpdate) && Date.now() - lastUpdate < cycleMs) {
        return { enabled: true, created: null, reason: "cooldown" };
      }
    }

    const created = await this.createTask({
      objective,
      trigger: "CRON",
      autonomyMode: this.defaultAutonomyMode(env),
    });
    return { enabled: true, created, reason: "created" };
  }

  async getExecution(executionId) {
    return this.orchestrator.get(executionId);
  }

  async listExecutions(filters = {}) {
    return this.orchestrator.list(filters);
  }

  async runExecution(executionId) {
    return this.orchestrator.run(executionId);
  }

  async approveExecution(executionId) {
    const execution = await this.orchestrator.approve(executionId);
    return this.orchestrator.run(execution.id);
  }

  async provideInformation(executionId, context = {}) {
    const execution = await this.orchestrator.provideInformation(executionId, context);
    return this.orchestrator.run(execution.id);
  }

  async cancelExecution(executionId, reason) {
    return this.orchestrator.cancel(executionId, reason);
  }

  async createForWorkflowExecution(workflowExecutionId, input = {}) {
    const execution = await this.workflows.getExecution(workflowExecutionId);
    if (!execution) throw new Error("Workflow execution not found.");
    const workflow = await this.workflows.getWorkflow(execution.workflowId);
    if (!workflow) throw new Error("Workflow definition not found.");

    const channelId =
      input.channelId ||
      execution.input?.channelId ||
      execution.input?.factoryChannelId ||
      null;
    const channel = channelId ? await this.channels.getChannel(channelId) : null;
    const fallbackMode = this.defaultAutonomyMode();
    const autonomyMode = normalizeAutonomyMode(
      input.autonomyMode ||
        workflow.autonomyMode ||
        channel?.strategy?.agentAutonomyMode ||
        execution.autonomyMode ||
        fallbackMode,
      fallbackMode,
    );

    return this.orchestrator.createTask({
      objective:
        input.objective ||
        `Advance workflow "${workflow.name}" using only approved ClipForge tools.`,
      trigger: input.trigger || "INTERNAL_EVENT",
      autonomyMode,
      workflowId: workflow.id,
      workflowExecutionId: execution.id,
      projectId: execution.projectId || input.projectId || null,
      channelId,
      context: {
        workflow: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          autonomyMode,
        },
        execution: {
          id: execution.id,
          status: execution.status,
          currentStepId: execution.currentStepId,
          currentStepIndex: execution.currentStepIndex,
          input: execution.input || {},
        },
        ...(input.context || {}),
        agentRules: this.rules,
      },
      limits: {
        ...(input.limits || {}),
        maxRetries: input.limits?.maxRetries ?? this.rules.maxRetries,
      },
    });
  }

  async runDue(options = {}) {
    const env = options.env || this.env;
    if (options.requireEnabled !== false && !this.isEnabled(env)) {
      return { enabled: false, processed: 0, executions: [], seeded: null };
    }

    const seedResult = options.seedAutonomousCycle === false
      ? null
      : await this.ensureAutonomousCycle({ env, requireEnabled: false });

    const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
    const pending = await this.orchestrator.list({
      status: ["QUEUED", "WAITING_RETRY"],
    });
    const results = [];

    for (const execution of pending.slice(0, limit)) {
      try {
        results.push(await this.orchestrator.run(execution.id));
      } catch (error) {
        results.push({
          id: execution.id,
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      enabled: true,
      processed: results.length,
      executions: results,
      seeded: seedResult?.created?.id || null,
      seedReason: seedResult?.reason || null,
    };
  }
}
