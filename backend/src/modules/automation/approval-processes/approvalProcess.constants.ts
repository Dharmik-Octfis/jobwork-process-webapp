/**
 * Constants and Catalogs for the Zoho CRM-style Approval Process Engine.
 */

export const TRIGGER_TYPES = {
  CREATE_ONLY: 'CREATE_ONLY',
  EDIT_ONLY: 'EDIT_ONLY',
  CREATE_OR_EDIT: 'CREATE_OR_EDIT',
} as const;
export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES];

export const PROCESS_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type ProcessStatus = (typeof PROCESS_STATUS)[keyof typeof PROCESS_STATUS];

export const APPROVAL_REQUEST_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  STAGE_APPROVED: 'STAGE_APPROVED',
  FINAL_APPROVED: 'FINAL_APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUS)[keyof typeof APPROVAL_REQUEST_STATUS];

export const APPROVER_TYPES = {
  USER: 'USER',
  ROLE: 'ROLE',
  REPORTING_MANAGER: 'REPORTING_MANAGER',
  RECORD_OWNER: 'RECORD_OWNER',
  RECORD_CREATOR: 'RECORD_CREATOR',
  LOOKUP_USER: 'LOOKUP_USER',
} as const;
export type ApproverType = (typeof APPROVER_TYPES)[keyof typeof APPROVER_TYPES];

export const APPROVAL_MODES = {
  ANYONE: 'ANYONE',
  EVERYONE: 'EVERYONE',
  FIRST_RESPONSE: 'FIRST_RESPONSE',
  SEQUENTIAL: 'SEQUENTIAL',
} as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[keyof typeof APPROVAL_MODES];

export const ACTION_TYPES = {
  UPDATE_FIELDS: 'UPDATE_FIELDS',
  ASSIGN_TASK: 'ASSIGN_TASK',
  EMAIL_NOTIFICATION: 'EMAIL_NOTIFICATION',
  IN_APP_NOTIFICATION: 'IN_APP_NOTIFICATION',
  WEBHOOK: 'WEBHOOK',
  FUNCTION: 'FUNCTION',
} as const;
export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

export const TRIGGER_EVENTS = {
  FINAL_APPROVAL: 'FINAL_APPROVAL',
  REJECTION: 'REJECTION',
  STAGE_APPROVAL: 'STAGE_APPROVAL',
} as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[keyof typeof TRIGGER_EVENTS];

/**
 * Supported Field Data Types
 */
export const FIELD_DATA_TYPES = [
  'text',
  'textarea',
  'number',
  'decimal',
  'currency',
  'percentage',
  'integer',
  'date',
  'datetime',
  'boolean',
  'checkbox',
  'select',
  'multi_select',
  'radio',
  'email',
  'phone',
  'url',
  'lookup',
  'multi_lookup',
  'user',
  'owner',
  'status',
  'formula',
  'auto_number',
] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

/**
 * Dynamic Operators by Data Type
 */
export const OPERATORS_BY_DATA_TYPE: Record<string, Array<{ key: string; label: string }>> = {
  text: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'contains', label: 'contains' },
    { key: 'does_not_contain', label: 'does not contain' },
    { key: 'starts_with', label: 'starts with' },
    { key: 'ends_with', label: 'ends with' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  textarea: [
    { key: 'contains', label: 'contains' },
    { key: 'does_not_contain', label: 'does not contain' },
    { key: 'starts_with', label: 'starts with' },
    { key: 'ends_with', label: 'ends with' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  number: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'greater_than', label: 'greater than' },
    { key: 'greater_than_or_equal', label: 'greater than or equal to' },
    { key: 'less_than', label: 'less than' },
    { key: 'less_than_or_equal', label: 'less than or equal to' },
    { key: 'between', label: 'between' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  decimal: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'greater_than', label: 'greater than' },
    { key: 'greater_than_or_equal', label: 'greater than or equal to' },
    { key: 'less_than', label: 'less than' },
    { key: 'less_than_or_equal', label: 'less than or equal to' },
    { key: 'between', label: 'between' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  currency: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'greater_than', label: 'greater than' },
    { key: 'greater_than_or_equal', label: 'greater than or equal to' },
    { key: 'less_than', label: 'less than' },
    { key: 'less_than_or_equal', label: 'less than or equal to' },
    { key: 'between', label: 'between' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  percentage: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'greater_than', label: 'greater than' },
    { key: 'greater_than_or_equal', label: 'greater than or equal to' },
    { key: 'less_than', label: 'less than' },
    { key: 'less_than_or_equal', label: 'less than or equal to' },
    { key: 'between', label: 'between' },
  ],
  integer: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'greater_than', label: 'greater than' },
    { key: 'greater_than_or_equal', label: 'greater than or equal to' },
    { key: 'less_than', label: 'less than' },
    { key: 'less_than_or_equal', label: 'less than or equal to' },
    { key: 'between', label: 'between' },
  ],
  date: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'before', label: 'before' },
    { key: 'after', label: 'after' },
    { key: 'on_or_before', label: 'on or before' },
    { key: 'on_or_after', label: 'on or after' },
    { key: 'between', label: 'between' },
    { key: 'today', label: 'today' },
    { key: 'tomorrow', label: 'tomorrow' },
    { key: 'yesterday', label: 'yesterday' },
    { key: 'this_week', label: 'this week' },
    { key: 'this_month', label: 'this month' },
    { key: 'next_week', label: 'next week' },
    { key: 'next_month', label: 'next month' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  datetime: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'before', label: 'before' },
    { key: 'after', label: 'after' },
    { key: 'on_or_before', label: 'on or before' },
    { key: 'on_or_after', label: 'on or after' },
    { key: 'between', label: 'between' },
    { key: 'today', label: 'today' },
    { key: 'this_week', label: 'this week' },
    { key: 'this_month', label: 'this month' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  boolean: [
    { key: 'is_true', label: 'is true' },
    { key: 'is_false', label: 'is false' },
  ],
  checkbox: [
    { key: 'is_true', label: 'is selected' },
    { key: 'is_false', label: 'is not selected' },
  ],
  select: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  radio: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  status: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  multi_select: [
    { key: 'contains', label: 'contains' },
    { key: 'does_not_contain', label: 'does not contain' },
    { key: 'contains_any', label: 'contains any' },
    { key: 'contains_all', label: 'contains all' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  lookup: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  user: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
  owner: [
    { key: 'is', label: 'is' },
    { key: 'is_not', label: 'is not' },
    { key: 'is_empty', label: 'is empty' },
    { key: 'is_not_empty', label: 'is not empty' },
  ],
};

// Aliases
OPERATORS_BY_DATA_TYPE['email'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['phone'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['url'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['auto_number'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['formula'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['multi_lookup'] = OPERATORS_BY_DATA_TYPE['multi_select']!;
