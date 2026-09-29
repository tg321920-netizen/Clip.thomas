import { WorkflowService } from "../workflows/WorkflowService.mjs";

const RECIPE = {
  key: "OWNED_CONTENT_NEWS",
  name: "Owned Content — Research to Publish",
  description: "Trend → multi-source research → original script → narration → rights-cleared visuals → render → coherence/rights review → human approval → publication dry run → analytics.",
  steps: [
    { id: "trend", type: "OWNED_TREND", maxAttempts: 2 },
    { id: "research", type: "OWNED_RESEARCH", maxAttempts: 2 },
    { id: "script", type: "OWNED_SCRIPT", maxAttempts: 2 },
    { id: "audio", type: "OWNED_AUDIO", maxAttempts: 2 },
    { id: "visual", type: "OWNED_VISUAL", maxAttempts: 2 },
    { id: "render", type: "OWNED_RENDER", maxAttempts: 2 },
    { id: "gate", type: "OWNED_COHERENCE_RIGHTS", maxAttempts: 1 },
    { id: "approval", type: "APPROVAL", requiresApproval: true, maxAttempts: 1 },
    { id: "dry-run", type: "OWNED_DRY_RUN", maxAttempts: 2 },
    { id: "analytics", type: "OWNED_ANALYTICS", maxAttempts: 2 },
  ],
};

export class OwnedContentWorkflowRecipeService {
  constructor(options = {}) { this.workflows = options.workflows || new WorkflowService(); }
  getRecipe() { return JSON.parse(JSON.stringify(RECIPE)); }
  async ensure() {
    const workflows = await this.workflows.listWorkflows();
    const existing = workflows.find((workflow) => workflow.name === RECIPE.name);
    if (existing) return { workflow: existing, reused: true, recipeKey: RECIPE.key };
    const workflow = await this.workflows.createWorkflow({
      name: RECIPE.name,
      description: RECIPE.description,
      enabled: true,
      steps: RECIPE.steps,
    });
    return { workflow, reused: false, recipeKey: RECIPE.key };
  }
}
