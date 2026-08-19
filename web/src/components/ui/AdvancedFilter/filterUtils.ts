export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'contains_any'
  | 'contains_all'
  | 'is_true'
  | 'is_false'
  | 'has_file'
  | 'has_no_file'
  | 'contains_file_type';

export type FilterDataType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select'
  | 'boolean'
  | 'radio'
  | 'url'
  | 'file'
  | 'string' // Legacy alias
  | 'time'; // Legacy alias

export interface FilterField {
  key: string;
  label: string;
  dataType: FilterDataType;
  options?: { label: string; value: string | number }[];
}

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export function evaluateCondition(
  itemValue: unknown,
  operator: FilterOperator,
  filterValue: unknown,
  dataType: FilterDataType = 'text',
): boolean {
  if (dataType === 'multi_select') {
    const parseMultiSelect = (val: unknown): string[] => {
      if (val === null || val === undefined || val === '') return [];
      if (Array.isArray(val))
        return val
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean);
      return String(val)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const itemArr = parseMultiSelect(itemValue);

    if (operator === 'is_empty') return itemArr.length === 0;
    if (operator === 'is_not_empty') return itemArr.length > 0;

    const filterArr = parseMultiSelect(filterValue);
    if (filterArr.length === 0) return true; // Empty filter matches all

    switch (operator) {
      case 'contains_any':
        return filterArr.some((f) => itemArr.includes(f));
      case 'contains_all':
        return filterArr.every((f) => itemArr.includes(f));
      case 'not_contains':
        return !filterArr.some((f) => itemArr.includes(f));
      default:
        return false;
    }
  }

  // Common empty checks
  const isValueEmpty = itemValue === null || itemValue === undefined || itemValue === '';

  if (operator === 'is_empty' || operator === 'has_no_file') {
    if (Array.isArray(itemValue)) return itemValue.length === 0;
    return isValueEmpty;
  }
  if (operator === 'is_not_empty' || operator === 'has_file') {
    if (Array.isArray(itemValue)) return itemValue.length > 0;
    return !isValueEmpty;
  }

  // Boolean evaluation
  if (dataType === 'boolean') {
    const isTrue =
      operator === 'is_true' || (operator === 'equals' && String(filterValue) === 'true');
    const isFalse =
      operator === 'is_false' || (operator === 'equals' && String(filterValue) === 'false');

    if (operator === 'is_true' || isTrue) return itemValue === true;
    if (operator === 'is_false' || isFalse) return itemValue === false;

    // For general 'equals' fallback if used directly
    const filterBool = String(filterValue) === 'true';
    if (operator === 'equals') return itemValue === filterBool;
    if (operator === 'not_equals') return itemValue !== filterBool;
  }

  // Number / Currency / Percentage evaluation
  if (['number', 'currency', 'percentage'].includes(dataType)) {
    const val = Number(itemValue);

    if (operator === 'between') {
      const from = Number((filterValue as Record<string, unknown>)?.from);
      const to = Number((filterValue as Record<string, unknown>)?.to);
      if (isNaN(from) || isNaN(to)) return false;
      return val >= from && val <= to;
    }

    const filterVal = Number(filterValue);
    if (isNaN(filterVal)) return false;

    switch (operator) {
      case 'equals':
        return val === filterVal;
      case 'not_equals':
        return val !== filterVal;
      case 'gt':
        return val > filterVal;
      case 'lt':
        return val < filterVal;
      case 'gte':
        return val >= filterVal;
      case 'lte':
        return val <= filterVal;
      default:
        return false;
    }
  }

  // Date / DateTime / Time evaluation
  if (['date', 'datetime', 'time'].includes(dataType)) {
    if (!itemValue) return false;
    const valDate = new Date(itemValue as string | number | Date).getTime();

    if (operator === 'between') {
      const from = new Date(
        (filterValue as Record<string, string | number | Date>)?.from,
      ).getTime();
      const to = new Date((filterValue as Record<string, string | number | Date>)?.to).getTime();
      if (isNaN(from) || isNaN(to) || isNaN(valDate)) return false;
      return valDate >= from && valDate <= to;
    }

    const filterDate = new Date(filterValue as string | number | Date).getTime();
    if (isNaN(filterDate) || isNaN(valDate)) return false;

    switch (operator) {
      case 'equals':
        return valDate === filterDate;
      case 'not_equals':
        return valDate !== filterDate;
      case 'before':
      case 'lt':
        return valDate < filterDate;
      case 'after':
      case 'gt':
        return valDate > filterDate;
      case 'on_or_before':
      case 'lte':
        return valDate <= filterDate;
      case 'on_or_after':
      case 'gte':
        return valDate >= filterDate;
      default:
        return false;
    }
  }

  // Text / Default evaluation (Select, Radio, etc.)
  const val = String(itemValue || '').toLowerCase();
  const filterVal = String(filterValue || '').toLowerCase();

  switch (operator) {
    case 'contains':
      return val.includes(filterVal);
    case 'not_contains':
      return !val.includes(filterVal);
    case 'equals':
      return val === filterVal;
    case 'not_equals':
      return val !== filterVal;
    case 'starts_with':
      return val.startsWith(filterVal);
    case 'ends_with':
      return val.endsWith(filterVal);
    default:
      return true; // If unknown operator, default to true or false? Better true to not filter out if misconfigured.
  }
}

export const getOperatorsForType = (
  type: FilterDataType,
): { value: FilterOperator; label: string }[] => {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percentage':
      return [
        { value: 'equals', label: 'Equal To' },
        { value: 'not_equals', label: 'Not Equal To' },
        { value: 'gt', label: 'Greater Than' },
        { value: 'gte', label: 'Greater Than or Equal To' },
        { value: 'lt', label: 'Less Than' },
        { value: 'lte', label: 'Less Than or Equal To' },
        { value: 'between', label: 'Between' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
    case 'date':
    case 'datetime':
    case 'time':
      return [
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'before', label: 'Before' },
        { value: 'after', label: 'After' },
        { value: 'on_or_before', label: 'On or Before' },
        { value: 'on_or_after', label: 'On or After' },
        { value: 'between', label: 'Between' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
    case 'boolean':
      return [
        { value: 'is_true', label: 'Is True' }, // Will render as 'Is -> Yes'
        { value: 'is_false', label: 'Is False' },
      ];
    case 'select':
    case 'radio':
      return [
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
    case 'multi_select':
      return [
        { value: 'contains_any', label: 'Contains Any' },
        { value: 'contains_all', label: 'Contains All' },
        { value: 'not_contains', label: 'Does Not Contain' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
    case 'file':
      return [
        { value: 'has_file', label: 'Has File' },
        { value: 'has_no_file', label: 'Has No File' },
        { value: 'contains_file_type', label: 'Contains File Type' },
      ];
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'url':
    case 'string':
    default:
      return [
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'contains', label: 'Contains' },
        { value: 'not_contains', label: 'Does Not Contain' },
        { value: 'starts_with', label: 'Starts With' },
        { value: 'ends_with', label: 'Ends With' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
  }
};
