import type {
  ApprovalCriteria,
  CriteriaCondition,
  FieldMetadata,
} from './approvalProcess.types.ts';

type OperatorFn = (actual: unknown, expected: unknown, secondExpected?: unknown) => boolean;

/**
 * Registry of type-safe operator functions.
 */
const TEXT_OPERATORS: Record<string, OperatorFn> = {
  is: (a, e) => String(a ?? '').toLowerCase() === String(e ?? '').toLowerCase(),
  is_not: (a, e) => String(a ?? '').toLowerCase() !== String(e ?? '').toLowerCase(),
  contains: (a, e) =>
    String(a ?? '')
      .toLowerCase()
      .includes(String(e ?? '').toLowerCase()),
  does_not_contain: (a, e) =>
    !String(a ?? '')
      .toLowerCase()
      .includes(String(e ?? '').toLowerCase()),
  starts_with: (a, e) =>
    String(a ?? '')
      .toLowerCase()
      .startsWith(String(e ?? '').toLowerCase()),
  ends_with: (a, e) =>
    String(a ?? '')
      .toLowerCase()
      .endsWith(String(e ?? '').toLowerCase()),
  is_empty: (a) => a === null || a === undefined || String(a).trim() === '',
  is_not_empty: (a) => a !== null && a !== undefined && String(a).trim() !== '',
};

const NUMBER_OPERATORS: Record<string, OperatorFn> = {
  is: (a, e) => Number(a) === Number(e),
  is_not: (a, e) => Number(a) !== Number(e),
  greater_than: (a, e) => Number(a) > Number(e),
  greater_than_or_equal: (a, e) => Number(a) >= Number(e),
  less_than: (a, e) => Number(a) < Number(e),
  less_than_or_equal: (a, e) => Number(a) <= Number(e),
  between: (a, min, max) => {
    const num = Number(a);
    return num >= Number(min) && num <= Number(max);
  },
  is_empty: (a) => a === null || a === undefined || a === '',
  is_not_empty: (a) => a !== null && a !== undefined && a !== '',
};

function normalizeDateOnly(val: unknown): string | null {
  if (!val) return null;
  const d = new Date(val as string | number | Date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0]!;
}

const DATE_OPERATORS: Record<string, OperatorFn> = {
  is: (a, e) => normalizeDateOnly(a) === normalizeDateOnly(e),
  is_not: (a, e) => normalizeDateOnly(a) !== normalizeDateOnly(e),
  before: (a, e) => {
    const d1 = normalizeDateOnly(a);
    const d2 = normalizeDateOnly(e);
    return Boolean(d1 && d2 && d1 < d2);
  },
  after: (a, e) => {
    const d1 = normalizeDateOnly(a);
    const d2 = normalizeDateOnly(e);
    return Boolean(d1 && d2 && d1 > d2);
  },
  on_or_before: (a, e) => {
    const d1 = normalizeDateOnly(a);
    const d2 = normalizeDateOnly(e);
    return Boolean(d1 && d2 && d1 <= d2);
  },
  on_or_after: (a, e) => {
    const d1 = normalizeDateOnly(a);
    const d2 = normalizeDateOnly(e);
    return Boolean(d1 && d2 && d1 >= d2);
  },
  between: (a, min, max) => {
    const d = normalizeDateOnly(a);
    const dMin = normalizeDateOnly(min);
    const dMax = normalizeDateOnly(max);
    return Boolean(d && dMin && dMax && d >= dMin && d <= dMax);
  },
  today: (a) => {
    const todayStr = normalizeDateOnly(new Date());
    return normalizeDateOnly(a) === todayStr;
  },
  yesterday: (a) => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return normalizeDateOnly(a) === normalizeDateOnly(d);
  },
  tomorrow: (a) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return normalizeDateOnly(a) === normalizeDateOnly(d);
  },
  this_week: (a) => {
    const d = normalizeDateOnly(a);
    if (!d) return false;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return d >= normalizeDateOnly(startOfWeek)! && d <= normalizeDateOnly(endOfWeek)!;
  },
  this_month: (a) => {
    const d = normalizeDateOnly(a);
    if (!d) return false;
    const now = new Date();
    const [year, month] = d.split('-');
    return Number(year) === now.getFullYear() && Number(month) === now.getMonth() + 1;
  },
  is_empty: (a) => !a,
  is_not_empty: (a) => Boolean(a),
};

const BOOLEAN_OPERATORS: Record<string, OperatorFn> = {
  is_true: (a) => a === true || a === 'true' || a === 1 || a === '1',
  is_false: (a) => a === false || a === 'false' || a === 0 || a === '0' || !a,
};

const SELECT_OPERATORS: Record<string, OperatorFn> = {
  is: (a, e) => String(a ?? '').toLowerCase() === String(e ?? '').toLowerCase(),
  is_not: (a, e) => String(a ?? '').toLowerCase() !== String(e ?? '').toLowerCase(),
  is_empty: (a) => a === null || a === undefined || a === '',
  is_not_empty: (a) => a !== null && a !== undefined && a !== '',
};

const MULTI_SELECT_OPERATORS: Record<string, OperatorFn> = {
  contains: (a, e) => {
    const arr = Array.isArray(a) ? a : [a];
    return arr.some((item) => String(item).toLowerCase() === String(e).toLowerCase());
  },
  does_not_contain: (a, e) => {
    const arr = Array.isArray(a) ? a : [a];
    return !arr.some((item) => String(item).toLowerCase() === String(e).toLowerCase());
  },
  contains_any: (a, e) => {
    const arr = Array.isArray(a) ? a : [a];
    const targets = Array.isArray(e) ? e : [e];
    return targets.some((target) =>
      arr.some((item) => String(item).toLowerCase() === String(target).toLowerCase()),
    );
  },
  contains_all: (a, e) => {
    const arr = Array.isArray(a) ? a : [a];
    const targets = Array.isArray(e) ? e : [e];
    return targets.every((target) =>
      arr.some((item) => String(item).toLowerCase() === String(target).toLowerCase()),
    );
  },
  is_empty: (a) => !a || (Array.isArray(a) && a.length === 0),
  is_not_empty: (a) => Boolean(a) && (!Array.isArray(a) || a.length > 0),
};

export class CriteriaEvaluatorService {
  /**
   * Reads nested property from record using path (e.g. 'totalAmount' or 'customFields.chitty_no')
   */
  extractFieldValue(record: Record<string, unknown>, path: string): unknown {
    if (!path) return undefined;
    const parts = path.split('.');
    let current: unknown = record;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      const obj = current as Record<string, unknown>;
      if (part in obj) {
        current = obj[part];
      } else {
        const snakePart = part.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        const camelPart = part.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        current = obj[snakePart] ?? obj[camelPart];
      }
    }
    return current;
  }

  /**
   * Evaluates a single criteria condition against record data.
   */
  evaluateCondition(
    record: Record<string, unknown>,
    condition: CriteriaCondition,
    fieldDef?: FieldMetadata,
  ): boolean {
    const path = fieldDef?.apiName || condition.fieldId;
    const actualValue = this.extractFieldValue(record, path);
    const dataType = fieldDef?.dataType || 'text';
    const opKey = condition.operator.toLowerCase().replace(/\s+/g, '_');

    let opTable: Record<string, OperatorFn> = TEXT_OPERATORS;
    if (['number', 'decimal', 'currency', 'percentage', 'integer'].includes(dataType)) {
      opTable = NUMBER_OPERATORS;
    } else if (['date', 'datetime'].includes(dataType)) {
      opTable = DATE_OPERATORS;
    } else if (['boolean', 'checkbox'].includes(dataType)) {
      opTable = BOOLEAN_OPERATORS;
    } else if (['select', 'radio', 'status', 'lookup', 'user', 'owner'].includes(dataType)) {
      opTable = SELECT_OPERATORS;
    } else if (['multi_select', 'multi_lookup'].includes(dataType)) {
      opTable = MULTI_SELECT_OPERATORS;
    }

    const opFn = opTable[opKey] || TEXT_OPERATORS[opKey];
    if (!opFn) {
      // Unknown operator: fail closed
      console.warn(`[CriteriaEvaluator] Unknown operator ${condition.operator} for type ${dataType}`);
      return false;
    }

    return opFn(actualValue, condition.value, condition.secondValue);
  }

  /**
   * Validates criteria pattern syntax (e.g. "1 AND (2 OR 3)")
   */
  validatePattern(pattern: string, conditionIds: number[]): { valid: boolean; error?: string } {
    if (!pattern || pattern.trim() === '') {
      return { valid: false, error: 'Criteria pattern cannot be empty.' };
    }

    const trimmed = pattern.trim();
    // Allow single number
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!conditionIds.includes(num)) {
        return { valid: false, error: `Pattern references non-existent condition ${num}.` };
      }
      return { valid: true };
    }

    // Check parenthesis balance
    let depth = 0;
    for (const char of trimmed) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth < 0) return { valid: false, error: 'Mismatched parentheses in criteria pattern.' };
    }
    if (depth !== 0) return { valid: false, error: 'Mismatched parentheses in criteria pattern.' };

    // Check tokens
    const tokens = trimmed.match(/\(|\)|\bAND\b|\bOR\b|\d+/gi);
    if (!tokens) return { valid: false, error: 'Invalid criteria pattern format.' };

    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        const num = Number(token);
        if (!conditionIds.includes(num)) {
          return { valid: false, error: `Pattern references condition ${num} which does not exist.` };
        }
      } else if (!['AND', 'OR', '(', ')'].includes(token.toUpperCase())) {
        return { valid: false, error: `Unexpected token "${token}" in criteria pattern.` };
      }
    }

    // Attempt test evaluation with dummy booleans to check syntax
    try {
      const dummyMap = new Map<number, boolean>(conditionIds.map((id) => [id, true]));
      this.evaluatePattern(trimmed, dummyMap);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  /**
   * Evaluates pattern boolean expression using recursive descent AST evaluator.
   */
  evaluatePattern(pattern: string, conditionResults: Map<number, boolean>): boolean {
    const rawTokens = pattern.match(/\(|\)|\bAND\b|\bOR\b|\d+/gi);
    if (!rawTokens || rawTokens.length === 0) return true;

    const tokens = rawTokens.map((t) => t.toUpperCase());
    let index = 0;

    function parseExpression(): boolean {
      let left = parseTerm();
      while (index < tokens.length && tokens[index] === 'OR') {
        index++;
        const right = parseTerm();
        left = left || right;
      }
      return left;
    }

    function parseTerm(): boolean {
      let left = parseFactor();
      while (index < tokens.length && tokens[index] === 'AND') {
        index++;
        const right = parseFactor();
        left = left && right;
      }
      return left;
    }

    function parseFactor(): boolean {
      if (index >= tokens.length) {
        throw new Error('Unexpected end of pattern');
      }

      const token = tokens[index]!;
      if (token === '(') {
        index++;
        const val = parseExpression();
        if (index >= tokens.length || tokens[index] !== ')') {
          throw new Error('Expected closing parenthesis');
        }
        index++;
        return val;
      }

      if (/^\d+$/.test(token)) {
        index++;
        const condId = Number(token);
        return conditionResults.get(condId) ?? false;
      }

      throw new Error(`Unexpected token "${token}" in criteria pattern`);
    }

    const result = parseExpression();
    if (index < tokens.length) {
      throw new Error(`Unexpected token "${tokens[index]}" at end of pattern`);
    }

    return result;
  }

  /**
   * Evaluates entire ApprovalCriteria object against a record.
   */
  evaluateCriteria(
    record: Record<string, unknown>,
    criteria: ApprovalCriteria,
    fieldMetadataMap: Map<string, FieldMetadata>,
  ): boolean {
    if (!criteria.conditions || criteria.conditions.length === 0) {
      // Empty criteria matches everything
      return true;
    }

    const conditionResults = new Map<number, boolean>();
    for (const cond of criteria.conditions) {
      const fieldDef = fieldMetadataMap.get(cond.fieldId);
      const passed = this.evaluateCondition(record, cond, fieldDef);
      conditionResults.set(cond.id, passed);
    }

    const pattern = criteria.pattern || criteria.conditions.map((c) => c.id).join(' AND ');
    return this.evaluatePattern(pattern, conditionResults);
  }
}

export const criteriaEvaluatorService = new CriteriaEvaluatorService();
