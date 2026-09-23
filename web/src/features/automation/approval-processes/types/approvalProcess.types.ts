export type TriggerType = 'CREATE_ONLY' | 'EDIT_ONLY' | 'CREATE_OR_EDIT';
export type ProcessStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type ApprovalRequestStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'STAGE_APPROVED'
  | 'FINAL_APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type ApproverType =
  | 'USER'
  | 'ROLE'
  | 'REPORTING_MANAGER'
  | 'RECORD_OWNER'
  | 'RECORD_CREATOR'
  | 'LOOKUP_USER';

export type ApprovalMode = 'ANYONE' | 'EVERYONE' | 'FIRST_RESPONSE' | 'SEQUENTIAL';

export type ActionType =
  | 'UPDATE_FIELDS'
  | 'ASSIGN_TASK'
  | 'EMAIL_NOTIFICATION'
  | 'IN_APP_NOTIFICATION'
  | 'WEBHOOK'
  | 'FUNCTION';

export type TriggerEvent = 'FINAL_APPROVAL' | 'REJECTION' | 'STAGE_APPROVAL';

export type FieldDataType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'currency'
  | 'percentage'
  | 'integer'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'checkbox'
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'email'
  | 'phone'
  | 'url'
  | 'lookup'
  | 'multi_lookup'
  | 'user'
  | 'owner'
  | 'status'
  | 'formula'
  | 'auto_number';

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
  secondValue?: unknown;
}

export interface ApprovalCriteria {
  conditions: CriteriaCondition[];
  pattern: string;
}

export interface RecordModificationConfig {
  allowApproverEditPending: boolean;
  approverEditableFields?: string[];
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
  toRecipients: string[];
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
  payloadTemplate?: string;
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
  criteria: CriteriaCondition[];
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
}

export interface UpdateApprovalProcessInput {
  name: string;
  description?: string;
  moduleId: string;
  triggerType: TriggerType;
  rules: ApprovalProcessRuleInput[];
  admins?: ApprovalProcessAdminInput[];
}

export interface ApprovalProcessRuleDetails extends ApprovalProcessRuleInput {
  id: string;
  processId: string;
  stages: Array<ApprovalStageInput & { id: string }>;
  finalActions: Array<ApprovalActionInput & { id: string }>;
  rejectionActions: Array<ApprovalActionInput & { id: string }>;
}

export interface ApprovalProcessDetails {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  moduleId: string;
  moduleName?: string;
  triggerType: TriggerType;
  status: ProcessStatus;
  priority: number;
  currentVersion: number;
  rulesCount: number;
  rules: any[];
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
  isApproverForCurrentUser?: boolean;
}

export type ApprovalProcessDetail = ApprovalProcessDetails;
export type CreateApprovalProcessPayload = CreateApprovalProcessInput;
export type UpdateApprovalProcessPayload = Omit<Partial<UpdateApprovalProcessInput>, 'rules'> & {
  adminUserIds?: string[];
  rules?: any[];
};
export type ApprovalRequestDetail = ApprovalRequestDetails;

export interface ApprovalActionConfig {
  id?: string;
  name: string;
  actionType: ActionType;
  config: Record<string, unknown>;
}

export interface ApprovalStageConfig {
  id?: string;
  name: string;
  stageOrder: number;
  approverDefinition: {
    type: ApproverType;
    userIds?: string[];
    roleIds?: string[];
    lookupFieldId?: string;
  };
  approvalMode: ApprovalMode;
  recordModification?: {
    allowApproverEditPending: boolean;
    approverEditableFields?: string[];
  };
  stageApprovalActions?: ApprovalActionConfig[];
}

export interface ApprovalProcessRuleConfig {
  id?: string;
  name: string;
  ruleOrder: number;
  criteria: ApprovalCriteria;
  stages: ApprovalStageConfig[];
  finalApprovalActions?: ApprovalActionConfig[];
  rejectionActions?: ApprovalActionConfig[];
}

