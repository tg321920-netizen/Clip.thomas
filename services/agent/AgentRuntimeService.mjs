import { AgentOrchestrator } from "./AgentOrchestrator.mjs";
import { AgentToolRegistry } from "./AgentToolRegistry.mjs";
import { normalizeAutonomyMode } from "./AgentContracts.mjs";
import { ZaiAgentProvider } from "./providers/ZaiAgentProvider.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { WorkflowService } from "../workflows/WorkflowService.mjs";

export class AgentRuntimeService {
  constructor(options = {}) {
    this.channels = options.channels || new ChannelService();
    this.workflows = options.workflows || new WorkflowService();
    this.tools = options.tools || new AgentToolRegistry({ channels: this.channels });
    this.provider = options.provider || new ZaiAgentProvider();
    this.orchestrator = options.orchestrator || new AgentOrchestrator({
      provider: this.provider,
      tools: this.tools,
    });
  }

  isEnabled(env = process.env) {
    return String(env.CLIPFORGE_AGENT_ENABLED || "").trim().toLowerCase() === "true";
  }

  async createTask(input = {}) {
    return this.orchestrator.createTask(input);
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
    const autonomyMode = normalizeAutonomyMode(
      input.autonomyMode ||
        workflow.autonomyMode ||
        channel?.strategy?.agentAutonomyMode ||
        execution.autonomyMode ||
        "MANUAL",
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
      },
      limits: input.limits,
    });
  }

  async runDue(options = {}) {
    if (options.requireEnabled !== false && !this.isEnabled(options.env || process.env)) {
      return { enabled: false, processed: 0, executions: [] };
    }

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

    return { enabled: true, processed: results.length, executions: results };
  }
}
