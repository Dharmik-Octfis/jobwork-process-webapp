export function validateCriteriaPattern(
  pattern: string,
  conditionIds: number[],
): { valid: boolean; error?: string } {
  if (!pattern || pattern.trim() === '') {
    return { valid: false, error: 'Criteria pattern cannot be empty.' };
  }

  const trimmed = pattern.trim();

  // Allow single condition number
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!conditionIds.includes(num)) {
      return { valid: false, error: `Pattern references condition ${num} which does not exist.` };
    }
    return { valid: true };
  }

  // Parentheses balance check
  let depth = 0;
  for (const char of trimmed) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) return { valid: false, error: 'Unmatched closing parenthesis ")".' };
  }
  if (depth !== 0) return { valid: false, error: 'Unmatched opening parenthesis "("' };

  // Tokenize
  const tokens = trimmed.match(/\(|\)|\bAND\b|\bOR\b|\d+/gi);
  if (!tokens || tokens.length === 0) {
    return { valid: false, error: 'Pattern contains no valid conditions or operators.' };
  }

  const upperTokens = tokens.map((t) => t.toUpperCase());

  // Check referenced condition IDs
  for (const t of upperTokens) {
    if (/^\d+$/.test(t)) {
      const num = Number(t);
      if (!conditionIds.includes(num)) {
        return { valid: false, error: `Condition ${num} does not exist.` };
      }
    } else if (!['AND', 'OR', '(', ')'].includes(t)) {
      return { valid: false, error: `Unexpected token "${t}". Use AND, OR, and parentheses.` };
    }
  }

  // Check syntax sequences
  for (let i = 0; i < upperTokens.length; i++) {
    const current = upperTokens[i]!;
    const next = upperTokens[i + 1];

    if (current === 'AND' || current === 'OR') {
      if (i === 0 || i === upperTokens.length - 1) {
        return { valid: false, error: `Operator "${current}" cannot be at the start or end.` };
      }
      if (next === 'AND' || next === 'OR' || next === ')') {
        return { valid: false, error: `Invalid operator placement near "${current} ${next}".` };
      }
    }

    if (/^\d+$/.test(current)) {
      if (next && /^\d+$/.test(next)) {
        return { valid: false, error: `Missing AND/OR operator between conditions ${current} and ${next}.` };
      }
      if (next === '(') {
        return { valid: false, error: `Missing operator between condition ${current} and "(".` };
      }
    }

    if (current === '(' && (next === 'AND' || next === 'OR' || next === ')')) {
      return { valid: false, error: `Invalid syntax after "(": found "${next}".` };
    }
  }

  return { valid: true };
}

export function generateDefaultPattern(conditionIds: number[]): string {
  if (conditionIds.length === 0) return '1';
  return conditionIds.join(' AND ');
}
