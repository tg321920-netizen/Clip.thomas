export type WorkflowStatus =
  | "draft"
  | "queued"
  | "processing"
  | "waiting_approval"
  | "waiting_information"
  | "approved"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStepStatus =
  | "pending"
  | "queued"
  | "processing"
  | "waiting_approval"
  | "waiting_information"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStepType =
  | "SOURCE"
  | "EXTRACT"
  | "UNDERSTAND"
  | "IDEA"
  | "CONTENT"
  | "EDIT"
  | "BRAND"
  | "APPROVAL"
  | "PUBLISH"
  | "ANALYTICS"
  | string;

export type WorkflowStepDefinition = {
  id: string;
  type: WorkflowStepType;
  name: string;
  config: Record<string, unknown>;
  requiresApproval: boolean;
  maxAttempts: number;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  version: number;
  enabled: boolean;
  steps: WorkflowStepDefinition[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowExecutionStep = WorkflowStepDefinition & {
  status: WorkflowStepStatus;
  attempts: number;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type WorkflowHistoryEvent = {
  at: string;
  type: string;
  stepId: string | null;
  data: Record<string, unknown>;
};

export type WorkflowExecution = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  projectId: string | null;
  idempotencyKey: string | null;
  status: WorkflowStatus;
  currentStepIndex: number | null;
  currentStepId: string | null;
  input: Record<string, unknown>;
  results: Record<string, unknown>;
  error: string | null;
  retries: number;
  steps: WorkflowExecutionStep[];
  history: WorkflowHistoryEvent[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
