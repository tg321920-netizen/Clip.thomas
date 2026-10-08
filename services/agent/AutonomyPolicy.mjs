import { normalizeAutonomyMode } from "./AgentContracts.mjs";

const PUBLICATION_TOOLS = new Set([
  "publishing.schedule",
  "publishing.publish",
]);

export function evaluateAgentToolPolicy({
  autonomyMode,
  toolName,
  realPublishingEnabled = agentRealPublishingEnabled(),
  agentRules = null,
} = {}) {
  const mode = normalizeAutonomyMode(autonomyMode);
  const tool = String(toolName || "").trim();

  if (!tool) {
    return { allowed: false, requiresApproval: false, reason: "Tool name is required." };
  }

  if (PUBLICATION_TOOLS.has(tool) && !realPublishingEnabled) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: "Real agent publishing is disabled.",
      code: "AGENT_REAL_PUBLISHING_OFF",
    };
  }

  if (
    PUBLICATION_TOOLS.has(tool) &&
    agentRules &&
    agentRules.publishingEnabled !== true
  ) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: "Agent rules keep publishing disabled.",
      code: "AGENT_RULES_PUBLISHING_OFF",
    };
  }

  if (mode === "MANUAL") {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "MANUAL mode requires human approval before every agent tool.",
    };
  }

  if (mode === "SEMI_AUTO" && PUBLICATION_TOOLS.has(tool)) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "SEMI_AUTO requires human approval before scheduling or publishing.",
    };
  }

  if (
    mode === "AUTO" &&
    PUBLICATION_TOOLS.has(tool) &&
    agentRules?.approvalRequired === true
  ) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Agent rules require human approval before scheduling or publishing.",
    };
  }

  return { allowed: true, requiresApproval: false, reason: null };
}

export function agentRealPublishingEnabled(env = process.env) {
  return String(env.CLIPFORGE_AGENT_REAL_PUBLISHING || "")
    .trim()
    .toLowerCase() === "true";
}
