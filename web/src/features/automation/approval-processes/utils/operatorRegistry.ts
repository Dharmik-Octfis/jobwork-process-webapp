export interface OperatorOption {
  key: string;
  label: string;
}

export const OPERATORS_BY_DATA_TYPE: Record<string, OperatorOption[]> = {
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

OPERATORS_BY_DATA_TYPE['email'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['phone'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['url'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['auto_number'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['formula'] = OPERATORS_BY_DATA_TYPE['text']!;
OPERATORS_BY_DATA_TYPE['multi_lookup'] = OPERATORS_BY_DATA_TYPE['multi_select']!;

export function getOperatorsForDataType(dataType?: string): OperatorOption[] {
  if (!dataType) return OPERATORS_BY_DATA_TYPE['text']!;
  return OPERATORS_BY_DATA_TYPE[dataType] || OPERATORS_BY_DATA_TYPE['text']!;
}

export function getDefaultOperator(dataType?: string): string {
  const ops = getOperatorsForDataType(dataType);
  return ops[0]?.key || 'is';
}

