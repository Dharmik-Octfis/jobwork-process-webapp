import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import type { CriteriaCondition, FieldMetadata } from '../types/approvalProcess.types';
import { getOperatorsForDataType, getDefaultOperator } from '../utils/operatorRegistry';

interface CriteriaRowProps {
  condition: CriteriaCondition;
  index: number;
  fields: FieldMetadata[];
  canDelete: boolean;
  isInvalid?: boolean;
  onChange: (updated: CriteriaCondition) => void;
  onDelete: () => void;
}

export function CriteriaRow({
  condition,
  index,
  fields,
  canDelete,
  isInvalid = false,
  onChange,
  onDelete,
}: CriteriaRowProps) {
  // Find current field definition
  const selectedField = useMemo(
    () => fields.find((f) => f.id === condition.fieldId || f.apiName === condition.fieldId),
    [fields, condition.fieldId],
  );

  const operators = useMemo(() => {
    return getOperatorsForDataType(selectedField?.dataType);
  }, [selectedField?.dataType]);

  const handleFieldChange = (newFieldId: string) => {
    const field = fields.find((f) => f.id === newFieldId || f.apiName === newFieldId);
    const defaultOp = getDefaultOperator(field?.dataType);
    onChange({
      ...condition,
      fieldId: newFieldId,
      operator: defaultOp,
      value: '',
      secondValue: undefined,
    });
  };

  const handleOperatorChange = (newOp: string) => {
    onChange({
      ...condition,
      operator: newOp,
      secondValue: newOp === 'between' || newOp === 'not_between' ? '' : undefined,
    });
  };

  const isBetween = condition.operator === 'between' || condition.operator === 'not_between';
  const isEmptyCheck = condition.operator === 'is_empty' || condition.operator === 'is_not_empty';

  return (
    <div
      className={`ap-criteria-row${isInvalid ? ' is-invalid-row' : ''}`}
      data-condition-id={condition.id}
    >
      <span className="ap-criteria-num-badge">{index + 1}</span>

      {/* Field Selector */}
      <div className="ap-criteria-field-col">
        <select
          className="ap-select ap-criteria-select"
          value={condition.fieldId}
          onChange={(e) => handleFieldChange(e.target.value)}
          aria-label={`Condition ${index + 1} field`}
        >
          <option value="" disabled>
            Select Field...
          </option>
          {(fields || []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} {f.isCustom ? '(Custom)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Operator Selector */}
      <div className="ap-criteria-op-col">
        <select
          className="ap-select ap-criteria-select"
          value={condition.operator}
          onChange={(e) => handleOperatorChange(e.target.value)}
          disabled={!condition.fieldId}
          aria-label={`Condition ${index + 1} operator`}
        >
          {(operators || []).map((op) => (
            <option key={op.key} value={op.key}>
              {op.label}
            </option>
          ))}
        </select>
      </div>

      {/* Value Input (Dynamic based on data type & operator) */}
      <div className="ap-criteria-val-col">
        {isEmptyCheck ? (
          <div className="ap-criteria-empty-pill">No value required</div>
        ) : isBetween ? (
          <div className="ap-criteria-between-inputs">
            <input
              type={selectedField?.dataType === 'date' ? 'date' : 'number'}
              className="ap-input ap-criteria-input"
              placeholder="From"
              value={(condition.value as string) ?? ''}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
            />
            <span className="ap-criteria-between-and">and</span>
            <input
              type={selectedField?.dataType === 'date' ? 'date' : 'number'}
              className="ap-input ap-criteria-input"
              placeholder="To"
              value={(condition.secondValue as string) ?? ''}
              onChange={(e) => onChange({ ...condition, secondValue: e.target.value })}
            />
          </div>
        ) : selectedField?.dataType === 'boolean' || selectedField?.dataType === 'checkbox' ? (
          <select
            className="ap-select ap-criteria-select"
            value={String(condition.value)}
            onChange={(e) => onChange({ ...condition, value: e.target.value === 'true' })}
          >
            <option value="true">True / Yes</option>
            <option value="false">False / No</option>
          </select>
        ) : selectedField?.options && selectedField.options.length > 0 ? (
          <select
            className="ap-select ap-criteria-select"
            value={(condition.value as string) ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          >
            <option value="">Select option...</option>
            {(selectedField.options || []).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : selectedField?.dataType === 'date' || selectedField?.dataType === 'datetime' ? (
          <input
            type={selectedField.dataType === 'datetime' ? 'datetime-local' : 'date'}
            className="ap-input ap-criteria-input"
            value={(condition.value as string) ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        ) : selectedField?.dataType === 'number' ||
          selectedField?.dataType === 'decimal' ||
          selectedField?.dataType === 'currency' ||
          selectedField?.dataType === 'percentage' ||
          selectedField?.dataType === 'integer' ? (
          <input
            type="number"
            step="any"
            className="ap-input ap-criteria-input"
            placeholder="Value"
            value={(condition.value as string) ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        ) : (
          <input
            type="text"
            className="ap-input ap-criteria-input"
            placeholder="Type value..."
            value={(condition.value as string) ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        )}
      </div>

      {/* Delete Condition Button */}
      <div className="ap-criteria-action-col">
        <button
          type="button"
          className="ap-criteria-del-btn"
          onClick={onDelete}
          disabled={!canDelete}
          title={canDelete ? 'Remove condition' : 'At least one condition required'}
          aria-label="Remove condition"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
