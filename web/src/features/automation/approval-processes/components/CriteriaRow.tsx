import { useMemo } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import type { CriteriaCondition, FieldMetadata } from '../types/approvalProcess.types';
import { getOperatorsForDataType, getDefaultOperator } from '../utils/operatorRegistry';
import { useFkLookupOptions } from '../api/useFkLookupOptions';
import { LocalComboBox } from '../../../../components/ui/LocalComboBox';

interface CriteriaRowProps {
  orgId: string;
  condition: CriteriaCondition;
  index: number;
  fields: FieldMetadata[];
  canDelete: boolean;
  isInvalid?: boolean;
  onChange: (updated: CriteriaCondition) => void;
  onDelete: () => void;
}

export function CriteriaRow({
  orgId,
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

  const fieldPickerOptions = useMemo(
    () =>
      (fields || []).map((f) => ({
        value: f.id,
        label: `${f.label}${f.isCustom ? ' (Custom)' : ''}`,
      })),
    [fields],
  );

  const operators = useMemo(() => {
    return getOperatorsForDataType(selectedField?.dataType);
  }, [selectedField?.dataType]);

  // Fetch related records when the field is a FK lookup
  const { options: fkOptions, isLoading: fkLoading } = useFkLookupOptions(
    orgId,
    selectedField?.relatedModule,
  );

  const fkComboBoxOptions = useMemo(
    () => fkOptions.map((opt) => ({ value: opt.id, label: opt.label })),
    [fkOptions],
  );

  const picklistComboBoxOptions = useMemo(
    () => (selectedField?.options || []).map((opt) => ({ value: opt.id, label: opt.label })),
    [selectedField?.options],
  );

  const handleFieldChange = (newFieldId: string) => {
    if (!newFieldId) {
      onChange({
        ...condition,
        fieldId: '',
        operator: 'is',
        value: '',
        secondValue: undefined,
      });
      return;
    }
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
    const isNowBetween = newOp === 'between' || newOp === 'not_between';
    const isNowEmpty = newOp === 'is_empty' || newOp === 'is_not_empty';
    onChange({
      ...condition,
      operator: newOp,
      value: isNowEmpty ? '' : condition.value,
      secondValue: isNowBetween ? (condition.secondValue ?? '') : undefined,
    });
  };

  const isBetween = condition.operator === 'between' || condition.operator === 'not_between';
  const isEmptyCheck = condition.operator === 'is_empty' || condition.operator === 'is_not_empty';
  const isLookup = selectedField?.dataType === 'lookup' && !!selectedField.relatedModule;

  return (
    <div
      className={`ap-criteria-row${isInvalid ? ' is-invalid-row' : ''}`}
      data-condition-id={condition.id}
    >
      <span className="ap-criteria-num-badge">{index + 1}</span>

      {/* Field Selector (Searchable Dropdown) */}
      <div className="ap-criteria-field-col">
        <LocalComboBox
          options={fieldPickerOptions}
          value={condition.fieldId || null}
          onChange={(newFieldId) => {
            handleFieldChange(newFieldId || '');
          }}
          placeholder="Select Field..."
          portal={true}
          style={{ width: '100%' }}
          ariaLabel={`Condition ${index + 1} field`}
        />
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
        ) : /* FK Lookup — Searchable dropdown of active related records */
        isLookup ? (
          fkLoading ? (
            <div className="ap-criteria-fk-loading">
              <Loader2 size={14} className="ap-spin" />
              <span>Loading {selectedField.label}…</span>
            </div>
          ) : (
            <LocalComboBox
              options={fkComboBoxOptions}
              value={(condition.value as string) || null}
              onChange={(newVal) => onChange({ ...condition, value: newVal || '' })}
              placeholder={`Select ${selectedField.label}…`}
              portal={true}
              style={{ width: '100%' }}
              ariaLabel={`Condition ${index + 1} value`}
            />
          )
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
          <LocalComboBox
            options={picklistComboBoxOptions}
            value={(condition.value as string) || null}
            onChange={(newVal) => onChange({ ...condition, value: newVal || '' })}
            placeholder="Select option..."
            portal={true}
            style={{ width: '100%' }}
            ariaLabel={`Condition ${index + 1} value`}
          />
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
            placeholder={condition.fieldId ? 'Type value...' : 'Select a field first...'}
            value={(condition.value as string) ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            disabled={!condition.fieldId}
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
