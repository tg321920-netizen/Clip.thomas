export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "CANCELLED";

export type ApprovalSubjectType =
  | "CONTENT_GENERATION"
  | "WORKFLOW_EXECUTION"
  | "PUBLICATION"
  | "CAMPAIGN"
  | "CONNECTION"
  | "BUDGET"
  | "DELETION"
  | "INFORMATION";

export type ApprovalRequest = {
  id: string;
  projectId: string | null;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  title: string;
  message: string;
  status: ApprovalStatus;
  selectedVariantId: string | null;
  note: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type InternalNotification = {
  id: string;
  projectId: string | null;
  type: "APPROVAL_REQUIRED" | "APPROVAL_RESOLVED" | "INFORMATION_REQUIRED" | "ERROR" | "INFO";
  title: string;
  message: string;
  subjectType: string | null;
  subjectId: string | null;
  readAt: string | null;
  createdAt: string;
};
