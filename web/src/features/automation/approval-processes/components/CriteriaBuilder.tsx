import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, RotateCcw, AlertCircle } from 'lucide-react';
import { CriteriaRow } from './CriteriaRow';
import type {
  ApprovalCriteria,
  CriteriaCondition,
  FieldMetadata,
} from '../types/approvalProcess.types';
import { validateCriteriaPattern } from '../utils/patternValidator';
import { getDefaultOperator } from '../utils/operatorRegistry';

interface CriteriaBuilderProps {
  criteria: ApprovalCriteria;
  fields: FieldMetadata[];
  onChange: (updated: ApprovalCriteria) => void;
}

/** Returns true if this condition needs no value (operator is self-sufficient) */
function isValuelessOperator(op: string): boolean {
  return op === 'is_empty' || op === 'is_not_empty';
}

/** Returns true if a condition is fully filled out */
function isConditionComplete(c: CriteriaCondition): boolean {
  if (!c.fieldId) return false;
  if (isValuelessOperator(c.operator)) return true;
  const val = c.value;
  if (val === null || val === undefined || String(val).trim() === '') return false;
  // For between operators, also require secondValue
  if (c.operator === 'between' || c.operator === 'not_between') {
    const val2 = c.secondValue;
    if (val2 === null || val2 === undefined || String(val2).trim() === '') return false;
  }
  return true;
}

export function CriteriaBuilder({ criteria, fields, onChange }: CriteriaBuilderProps) {
  const [isPatternDirty, setIsPatternDirty] = useState(false);
  const [showValidationBanner, setShowValidationBanner] = useState(false);

  const conditions = useMemo(() => {
    if (Array.isArray(criteria?.conditions)) return criteria.conditions;
    if (Array.isArray(criteria)) return criteria as CriteriaCondition[];
    return [];
  }, [criteria]);

  const pattern = criteria?.pattern || '1';

  const conditionIds = useMemo(() => {
    return conditions.map((_, idx) => idx + 1);
  }, [conditions]);

  const validation = useMemo(() => {
    return validateCriteriaPattern(pattern, conditionIds);
  }, [pattern, conditionIds]);

  /** Indices (0-based) of incomplete conditions */
  const incompleteIndices = useMemo(() => {
    return conditions
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !isConditionComplete(c))
      .map(({ i }) => i);
  }, [conditions]);

  const hasIncomplete = incompleteIndices.length > 0;

  const handleRowChange = (index: number, updatedCondition: CriteriaCondition) => {
    const nextConditions = [...conditions];
    nextConditions[index] = updatedCondition;
    onChange({
      conditions: nextConditions,
      pattern,
    });
  };

  const handleAddCondition = (logic: 'AND' | 'OR' = 'AND') => {
    // Block if any existing condition is incomplete
    if (hasIncomplete) {
      setShowValidationBanner(true);
      return;
    }

    setShowValidationBanner(false);
    const nextId = conditions.length + 1;
    const defaultField = fields[0]?.id || '';
    const defaultOp = getDefaultOperator(fields[0]?.dataType);

    const newCondition: CriteriaCondition = {
      id: nextId,
      fieldId: defaultField,
      operator: defaultOp,
      value: '',
    };

    const nextConditions = [...conditions, newCondition];

    // If user hasn't typed a custom pattern, auto-extend the pattern
    let nextPattern = pattern;
    if (!isPatternDirty) {
      if (nextConditions.length === 1) {
        nextPattern = '1';
      } else {
        nextPattern = `(${pattern} ${logic} ${nextId})`;
      }
    } else {
      nextPattern = `${pattern} ${logic} ${nextId}`;
    }

    onChange({
      conditions: nextConditions,
      pattern: nextPattern,
    });
  };

  const handleDeleteCondition = (index: number) => {
    if (conditions.length <= 1) return;

    const nextConditions = conditions
      .filter((_, i) => i !== index)
      .map((c, i) => ({ ...c, id: i + 1 }));

    // Rebuild default pattern
    const nextIds = nextConditions.map((_, i) => i + 1);
    const nextPattern = nextIds.join(' AND ');

    setIsPatternDirty(false);
    setShowValidationBanner(false);
    onChange({
      conditions: nextConditions,
      pattern: nextPattern,
    });
  };

  const handleResetPattern = () => {
    const defaultPattern = conditionIds.join(' AND ');
    setIsPatternDirty(false);
    onChange({
      conditions,
      pattern: defaultPattern,
    });
  };

  return (
    <div className="ap-criteria-builder">
      <div className="ap-card-header">
        <h3 className="ap-card-title">Approval Criteria</h3>
        <span className="ap-card-subtitle">
          Specify which records must go through this approval process
        </span>
      </div>

      <div className="ap-criteria-list">
        {conditions.length === 0 ? (
          <div style={{ padding: '12px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
            No criteria defined.
          </div>
        ) : (
          conditions.map((condition, index) => (
            <CriteriaRow
              key={condition.id || index}
              condition={condition}
              index={index}
              fields={fields}
              canDelete={conditions.length > 1}
              isInvalid={showValidationBanner && incompleteIndices.includes(index)}
              onChange={(updated) => handleRowChange(index, updated)}
              onDelete={() => handleDeleteCondition(index)}
            />
          ))
        )}
      </div>

      {/* Validation banner – shown when user tries to add without filling all values */}
      {showValidationBanner && hasIncomplete && (
        <div className="ap-criteria-validation-banner">
          <AlertCircle size={15} className="ap-criteria-validation-icon" />
          <span>
            Please fill in all required values before adding a new condition.{' '}
            <strong>
              {incompleteIndices.length === 1
                ? `Condition ${incompleteIndices[0] + 1} is incomplete.`
                : `Conditions ${incompleteIndices.map((i) => i + 1).join(', ')} are incomplete.`}
            </strong>
          </span>
        </div>
      )}

      <div className="ap-criteria-actions-bar">
        <div className="ap-criteria-add-buttons">
          <button
            type="button"
            className={`ap-text-button${hasIncomplete ? ' is-disabled' : ''}`}
            onClick={() => handleAddCondition('AND')}
            title={hasIncomplete ? 'Fill in all existing conditions first' : undefined}
          >
            + Add AND
          </button>
          <button
            type="button"
            className={`ap-text-button${hasIncomplete ? ' is-disabled' : ''}`}
            onClick={() => handleAddCondition('OR')}
            title={hasIncomplete ? 'Fill in all existing conditions first' : undefined}
          >
            + Add OR
          </button>
        </div>
      </div>

      {/* Criteria Pattern Box matching Zoho Screenshot 2 */}
      <div className="ap-pattern-box">
        <div className="ap-pattern-header">
          <label htmlFor="criteria-pattern" className="ap-pattern-label">
            Criteria Pattern:
          </label>
          <button
            type="button"
            className="ap-pattern-reset"
            onClick={handleResetPattern}
            title="Reset pattern to (1 AND 2 AND ...)"
          >
            <RotateCcw size={12} /> Reset to Default
          </button>
        </div>

        <div className="ap-pattern-input-wrapper">
          <input
            id="criteria-pattern"
            type="text"
            className={`ap-input ap-pattern-input ${!validation.valid ? 'is-invalid' : ''}`}
            value={criteria.pattern}
            onChange={(e) => {
              setIsPatternDirty(true);
              onChange({ ...criteria, pattern: e.target.value });
            }}
            placeholder="e.g. (1 AND (2 OR 3))"
            aria-invalid={!validation.valid}
            aria-describedby="pattern-feedback"
          />
          <div className="ap-pattern-status">
            {validation.valid ? (
              <span className="ap-pattern-valid" title="Pattern is mathematically valid">
                <CheckCircle2 size={16} />
              </span>
            ) : (
              <span className="ap-pattern-invalid" title={validation.error}>
                <AlertTriangle size={16} />
              </span>
            )}
          </div>
        </div>

        <div id="pattern-feedback" className="ap-pattern-feedback">
          {!validation.valid ? (
            <span className="ap-pattern-error">{validation.error}</span>
          ) : (
            <span className="ap-pattern-hint">
              Use condition numbers with AND, OR, and parentheses e.g.{' '}
              <code>(1 AND (2 OR 3))</code>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
