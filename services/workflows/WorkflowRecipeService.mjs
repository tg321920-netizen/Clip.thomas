import { WorkflowService } from "./WorkflowService.mjs";

const RECIPES = [
  {
    key: "VIDEO_TO_CLIPS",
    name: "Video largo → clips",
    description: "Proyecto ClipForge → extracción → plan → contenido → aprobación → edición → simulación de publicación.",
    steps: baseSteps(),
  },
  {
    key: "PRODUCT_TO_AD",
    name: "Producto → anuncio",
    description: "Información autorizada de producto → análisis → idea → copy/creativo → aprobación → simulación.",
    steps: baseSteps(),
  },
  {
    key: "COMPANY_WEEK_CONTENT",
    name: "Empresa → semana de contenido",
    description: "Información de empresa → estrategia → variantes → aprobación → preparación de calendario.",
    steps: baseSteps({ publishing: false }),
  },
  {
    key: "METABOT_ADVERTISING",
    name: "MetaBot → publicidad",
    description: "Información autorizada de MetaBot → beneficio → demostración → contenido → aprobación → Facebook/Instagram DRY RUN.",
    steps: baseSteps(),
  },
  {
    key: "URL_TO_CONTENT",
    name: "URL → contenido",
    description: "Página autorizada → extracción segura → contenido original → aprobación → simulación.",
    steps: baseSteps(),
  },
];

export class WorkflowRecipeService {
  constructor(options = {}) {
    this.workflows = options.workflows || new WorkflowService();
  }

  listRecipes() {
    return RECIPES.map((recipe) => ({ key: recipe.key, name: recipe.name, description: recipe.description, steps: recipe.steps }));
  }

  async ensureRecipes() {
    const existing = await this.workflows.listWorkflows();
    const output = [];
    for (const recipe of RECIPES) {
      const found = existing.find((workflow) => workflow?.metadata?.recipeKey === recipe.key || workflow?.name === recipe.name);
      if (found) {
        output.push({ recipeKey: recipe.key, workflow: found, reused: true });
        continue;
      }
      const workflow = await this.workflows.createWorkflow({
        name: recipe.name,
        description: recipe.description,
        enabled: true,
        steps: recipe.steps,
      });
      // WorkflowService intentionally keeps a compact schema. recipeKey is returned by this service rather than mutating it.
      output.push({ recipeKey: recipe.key, workflow, reused: false });
    }
    return output;
  }
}

function baseSteps(options = {}) {
  const publishing = options.publishing !== false;
  const steps = [
    { id: "source", type: "SOURCE", maxAttempts: 2 },
    { id: "extract", type: "EXTRACT", maxAttempts: 3 },
    { id: "understand", type: "UNDERSTAND", maxAttempts: 2 },
    { id: "idea", type: "IDEA", maxAttempts: 2 },
    { id: "content", type: "CONTENT", maxAttempts: 2 },
    { id: "approval", type: "APPROVAL", requiresApproval: true, maxAttempts: 1 },
    { id: "edit", type: "EDIT", maxAttempts: 2 },
    { id: "brand", type: "BRAND", maxAttempts: 1 },
  ];
  if (publishing) steps.push({ id: "publish", type: "PUBLISH", maxAttempts: 2 });
  steps.push({ id: "analytics", type: "ANALYTICS", maxAttempts: 2 });
  return steps;
}
