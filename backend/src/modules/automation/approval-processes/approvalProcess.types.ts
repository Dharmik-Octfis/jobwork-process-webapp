import type {
  TriggerType,
  ProcessStatus,
  ApprovalRequestStatus,
  ApproverType,
  ApprovalMode,
  ActionType,
  TriggerEvent,
  FieldDataType,
} from './approvalProcess.constants.ts';

export type {
  TriggerType,
  ProcessStatus,
  ApprovalRequestStatus,
  ApproverType,
  ApprovalMode,
  ActionType,
  TriggerEvent,
  FieldDataType,
};


export interface FieldOption {
  id: string;
  label: string;
}

export interface FieldMetadata {
  id: string;
  moduleId: string;
  apiName: string;
  label: string;
  dataType: FieldDataType;
  required: boolean;
  isActive: boolean;
  isCustom: boolean;
  options?: FieldOption[];
  relatedModule?: string | null;
}

export interface ModuleMetadata {
  id: string;
  code: string;
  name: string;
  category?: string;
  supportsApprovals: boolean;
  icon?: string;
}

export interface CriteriaCondition {
  id: number;
  fieldId: string;
  operator: string;
  value: unknown;
  secondValue?: unknown; // For "between" operator
}

export interface ApprovalCriteria {
  conditions: CriteriaCondition[];
  pattern: string; // e.g. "(1 AND (2 OR 3))"
}

export interface RecordModificationConfig {
  allowApproverEditPending: boolean;
  approverEditableFields?: string[]; // Empty or ['*'] means All Fields
  allowUserEditRejected: boolean;
  rejectedEditableFields?: string[];
}

export interface ApproverConfig {
  userIds?: string[];
  roleIds?: string[];
  lookupFieldId?: string;
}

export interface ApprovalStageInput {
  id?: string;
  name: string;
  stageOrder: number;
  approverType: ApproverType;
  approverConfig: ApproverConfig;
  approvalMode: ApprovalMode;
  assignTaskForApprovers: boolean;
  recordModificationConfig?: RecordModificationConfig;
}

export interface FieldUpdateActionConfig {
  updates: Array<{
    fieldId: string;
    value: unknown;
  }>;
}

export interface AssignTaskActionConfig {
  subject: string;
  dueDateDays?: number;
  assignedToUserId?: string;
  assignedToType?: 'USER' | 'RECORD_OWNER' | 'APPROVER';
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  description?: string;
}

export interface EmailNotificationActionConfig {
  toRecipients: string[]; // email addresses, user IDs, or tokens like "$RECORD_OWNER", "$APPROVERS"
  ccRecipients?: string[];
  bccRecipients?: string[];
  subject: string;
  message: string;
}

export interface InAppNotificationActionConfig {
  title: string;
  message: string;
  recipientType: 'APPROVERS' | 'RECORD_OWNER' | 'SPECIFIC_USER';
  userId?: string;
}

export interface WebhookActionConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  payloadTemplate?: string; // JSON string or blank for standard record payload
  timeoutMs?: number;
}

export interface FunctionActionConfig {
  functionName: string;
  parameters?: Record<string, unknown>;
}

export type ActionConfig =
  | FieldUpdateActionConfig
  | AssignTaskActionConfig
  | EmailNotificationActionConfig
  | InAppNotificationActionConfig
  | WebhookActionConfig
  | FunctionActionConfig;

export interface ApprovalActionInput {
  id?: string;
  stageId?: string | null;
  triggerEvent: TriggerEvent;
  actionType: ActionType;
  actionConfig: ActionConfig;
}

export interface ApprovalProcessAdminInput {
  userId: string;
  canOverride?: boolean;
  canReassign?: boolean;
}

export interface ApprovalProcessRuleInput {
  id?: string;
  name: string;
  ruleOrder: number;
  criteria: CriteriaCondition[] | ApprovalCriteria;
  criteriaPattern: string;
  stages: ApprovalStageInput[];
  finalActions: ApprovalActionInput[];
  rejectionActions: ApprovalActionInput[];
}

export interface CreateApprovalProcessInput {
  name: string;
  description?: string;
  moduleId: string;
  triggerType: TriggerType;
  /** When true, the service will attempt to activate the process immediately after creation. */
  activateImmediately?: boolean;
}

export interface UpdateApprovalProcessInput {
  name: string;
  description?: string;
  moduleId: string;
  triggerType: TriggerType;
  rules: ApprovalProcessRuleInput[];
  admins?: ApprovalProcessAdminInput[];
}

export interface ApprovalProcessRuleDetails extends Omit<ApprovalProcessRuleInput, 'stages' | 'finalActions' | 'rejectionActions' | 'criteria'> {
  id: string;
  processId: string;
  criteria: CriteriaCondition[] | ApprovalCriteria;
  stages: Array<ApprovalStageInput & { id: string }>;
  finalActions: Array<ApprovalActionInput & { id: string }>;
  finalApprovalActions?: Array<ApprovalActionInput & { id: string }>;
  rejectionActions: Array<ApprovalActionInput & { id: string }>;
}

export interface ApprovalProcessDetails {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  moduleId: string;
  triggerType: TriggerType;
  status: ProcessStatus;
  priority: number;
  currentVersion: number;
  rulesCount: number;
  rules: ApprovalProcessRuleDetails[];
  admins: Array<{
    id: string;
    userId: string;
    fullName?: string;
    email?: string;
    canOverride: boolean;
    canReassign: boolean;
  }>;
  createdBy: string | null;
  createdByName?: string;
  updatedBy: string | null;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalProcessListItem {
  id: string;
  name: string;
  description: string | null;
  moduleId: string;
  moduleName: string;
  triggerType: TriggerType;
  status: ProcessStatus;
  priority: number;
  currentVersion: number;
  rulesCount: number;
  stagesCount: number;
  createdByName?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestDetails {
  id: string;
  organizationId: string;
  processId: string;
  processName: string;
  processVersionId: string | null;
  ruleId: string | null;
  ruleName?: string;
  moduleId: string;
  moduleName: string;
  recordId: string;
  recordTitle: string;
  recordSnapshot: Record<string, unknown>;
  status: ApprovalRequestStatus;
  currentStageId: string | null;
  currentStageName?: string;
  requesterId: string | null;
  requesterName?: string;
  processAdminUserIds?: string[];
  submittedAt: string;
  completedAt: string | null;
  stages: Array<{
    id: string;
    stageId: string | null;
    stageOrder: number;
    name: string;
    status: string;
    approvalMode: string;
    approvers: Array<{
      id: string;
      userId: string;
      fullName?: string;
      email?: string;
      status: string;
      actionTakenAt: string | null;
      comment: string | null;
    }>;
  }>;
  history: Array<{
    id: string;
    eventType: string;
    actorId: string | null;
    actorName?: string;
    previousStatus: string | null;
    newStatus: string | null;
    comment: string | null;
    createdAt: string;
  }>;
  actions: Array<{
    id: string;
    actionType: string;
    triggerEvent: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    executedAt: string;
  }>;
}
