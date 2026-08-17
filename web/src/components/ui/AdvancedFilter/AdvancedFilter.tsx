import React, { useState, useRef, useEffect } from 'react';
import { Filter, Check } from 'lucide-react';
import './AdvancedFilter.css';

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
  | 'is_empty'
  | 'is_not_empty';

export type FilterDataType = 'string' | 'number' | 'date' | 'boolean';

export interface FilterField {
  key: string;
  label: string;
  dataType: FilterDataType;
}

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

interface AdvancedFilterProps {
  fields: FilterField[];
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  matchType?: 'any' | 'all';
  onMatchTypeChange?: (matchType: 'any' | 'all') => void;
}

const getOperatorsForType = (type: FilterDataType): { value: FilterOperator; label: string }[] => {
  switch (type) {
    case 'number':
    case 'date':
      return [
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'gt', label: 'Greater Than' },
        { value: 'lt', label: 'Less Than' },
        { value: 'gte', label: 'Greater Than or Equal' },
        { value: 'lte', label: 'Less Than or Equal' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
    case 'boolean':
      return [
        { value: 'equals', label: 'Is' },
      ];
    case 'string':
    default:
      return [
        { value: 'contains', label: 'Contains' },
        { value: 'not_contains', label: "Doesn't Contain" },
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'starts_with', label: 'Starts With' },
        { value: 'ends_with', label: 'Ends With' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
      ];
  }
};

export function AdvancedFilter({
  fields,
  conditions,
  onChange,
  matchType = 'all',
  onMatchTypeChange,
}: AdvancedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(fields[0]?.key || null);
  const [localConditions, setLocalConditions] = useState<FilterCondition[]>(conditions);
  const [prevConditions, setPrevConditions] = useState<FilterCondition[]>(conditions);
  const [localMatchType, setLocalMatchType] = useState<'any' | 'all'>(matchType);
  const [prevMatchType, setPrevMatchType] = useState<'any' | 'all'>(matchType);

  if (conditions !== prevConditions) {
    setPrevConditions(conditions);
    setLocalConditions(conditions);
  }

  if (matchType !== prevMatchType) {
    setPrevMatchType(matchType);
    setLocalMatchType(matchType);
  }

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeField = fields.find((f) => f.key === activeFieldKey) || fields[0];
  const activeConditionIndex = localConditions.findIndex((c) => c.field === activeField?.key);
  const activeCondition = activeConditionIndex >= 0 ? localConditions[activeConditionIndex] : null;

  const operators = activeField ? getOperatorsForType(activeField.dataType) : [];

  const handleApply = () => {
    onChange(localConditions);
    if (onMatchTypeChange) onMatchTypeChange(localMatchType);
    setIsOpen(false);
  };

  const handleReset = () => {
    setLocalConditions([]);
    onChange([]);
    setIsOpen(false);
  };

  const updateCondition = (updates: Partial<FilterCondition>) => {
    if (!activeField) return;

    const newConditions = [...localConditions];
    const index = newConditions.findIndex((c) => c.field === activeField.key);

    if (index >= 0) {
      newConditions[index] = { ...newConditions[index], ...updates };

      // If value is empty and operator is not "is_empty"/"is_not_empty", maybe we should remove it?
      // For now, keep it simple.
    } else {
      newConditions.push({
        field: activeField.key,
        operator: operators[0].value,
        value: '',
        ...updates,
      });
    }
    setLocalConditions(newConditions);
  };

  return (
    <div className="advanced-filter-container" ref={containerRef}>
      <button
        type="button"
        className={`filter-trigger-btn ${conditions.length > 0 ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Filter size={16} />
      </button>

      {isOpen && (
        <div className="filter-dropdown-panel">
          <div className="filter-header">
            <h3>Filter</h3>
            <button type="button" className="filter-reset-btn" onClick={handleReset}>
              Reset
            </button>
          </div>

          <div className="filter-body">
            <div className="filter-sidebar">
              {fields.map((field) => {
                const hasCondition = localConditions.some((c) => c.field === field.key);
                return (
                  <button
                    key={field.key}
                    type="button"
                    className={`filter-field-btn ${activeFieldKey === field.key ? 'active' : ''}`}
                    onClick={() => setActiveFieldKey(field.key)}
                  >
                    <span>{field.label}</span>
                    {hasCondition && <Check size={14} className="condition-indicator" />}
                  </button>
                );
              })}
            </div>

            <div className="filter-content">
              {activeField && (
                <div className="filter-condition-builder">
                  <div className="filter-field-title">{activeField.label}</div>

                  <div className="filter-control-group">
                    <label>Operator</label>
                    <select
                      className="filter-select"
                      value={activeCondition?.operator || operators[0].value}
                      onChange={(e) => updateCondition({ operator: e.target.value as FilterOperator })}
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!['is_empty', 'is_not_empty'].includes(activeCondition?.operator || '') && (
                    <div className="filter-control-group">
                      <label>Value</label>
                      <input
                        type={activeField.dataType === 'number' ? 'number' : 'text'}
                        className="filter-input"
                        placeholder="Enter value..."
                        value={(activeCondition?.value as string | number) || ''}
                        onChange={(e) => updateCondition({ value: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="filter-footer">
            <div className="match-type-toggle">
              <label>
                <input
                  type="radio"
                  name="matchType"
                  checked={localMatchType === 'any'}
                  onChange={() => setLocalMatchType('any')}
                />
                Any of these
              </label>
              <label>
                <input
                  type="radio"
                  name="matchType"
                  checked={localMatchType === 'all'}
                  onChange={() => setLocalMatchType('all')}
                />
                All of these
              </label>
            </div>
            <div className="filter-actions">
              <button type="button" className="btn-cancel" onClick={() => setIsOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-apply" onClick={handleApply}>
                Find
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
