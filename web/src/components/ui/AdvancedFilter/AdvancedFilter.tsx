import { useState, useRef, useEffect } from 'react';
import { Filter, Check, ChevronDown } from 'lucide-react';
import { Select } from '../Select';
import './AdvancedFilter.css';

export type { FilterOperator, FilterDataType, FilterField, FilterCondition } from './filterUtils';
import type { FilterOperator, FilterField, FilterCondition } from './filterUtils';
import { getOperatorsForType } from './filterUtils';

const isNoValueOperator = (op: FilterOperator) =>
  ['is_empty', 'is_not_empty', 'has_file', 'has_no_file', 'is_true', 'is_false'].includes(op);

const hasValidValue = (c: FilterCondition) => {
  if (isNoValueOperator(c.operator)) return true;
  if (c.operator === 'between') {
    const val = c.value as { from?: unknown; to?: unknown };
    return val && (val.from !== '' || val.to !== '') && (val.from != null || val.to != null);
  }
  return c.value !== '' && c.value !== null && c.value !== undefined;
};

interface AdvancedFilterProps {
  fields: FilterField[];
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  matchType?: 'any' | 'all';
  onMatchTypeChange?: (matchType: 'any' | 'all') => void;
  align?: 'left' | 'right';
  leftOffset?: number;
}

export function AdvancedFilter({
  fields,
  conditions,
  onChange,
  matchType = 'all',
  onMatchTypeChange,
  align = 'right',
  leftOffset = 0,
}: AdvancedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localConditions, setLocalConditions] = useState<FilterCondition[]>(conditions);
  const [prevConditions, setPrevConditions] = useState<FilterCondition[]>(conditions);
  const [localMatchType, setLocalMatchType] = useState<'any' | 'all'>(matchType);
  const [prevMatchType, setPrevMatchType] = useState<'any' | 'all'>(matchType);

  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  if (conditions !== prevConditions) {
    setPrevConditions(conditions);
    setLocalConditions(conditions);
  }

  if (matchType !== prevMatchType) {
    setPrevMatchType(matchType);
    setLocalMatchType(matchType);
  }

  const handleToggleOpen = () => {
    if (!isOpen) {
      const active = new Set<string>();
      localConditions.forEach((c: FilterCondition) => {
        if (hasValidValue(c)) {
          active.add(c.field);
        }
      });
      setExpandedFields(active);
    }
    setIsOpen(!isOpen);
  };

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleApply = () => {
    const active = localConditions.filter(hasValidValue);
    onChange(active);
    if (onMatchTypeChange) onMatchTypeChange(localMatchType);
    setIsOpen(false);
  };

  const handleReset = () => {
    setLocalConditions([]);
    onChange([]);
    setExpandedFields(new Set());
  };

  const toggleField = (key: string) => {
    const next = new Set(expandedFields);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedFields(next);
  };

  return (
    <div className="advanced-filter-container" ref={containerRef}>
      <button
        type="button"
        className={`filter-trigger-btn ${conditions.length > 0 ? 'active' : ''}`}
        onClick={handleToggleOpen}
      >
        <Filter size={16} />
      </button>

      {isOpen && (
        <div
          className="filter-dropdown-panel"
          style={{
            ...(align === 'left'
              ? { left: leftOffset, right: 'auto' }
              : { right: 0, left: 'auto' }),
          }}
        >
          <div className="filter-header">
            <h3>Filter</h3>
            <button type="button" className="filter-reset-btn" onClick={handleReset}>
              Reset
            </button>
          </div>

          <div className="filter-body">
            {fields.map((field) => {
              const condition = localConditions.find((c) => c.field === field.key);
              const operators = getOperatorsForType(field.dataType);
              const currentOperator = condition?.operator || operators[0].value;
              const isExpanded = expandedFields.has(field.key);
              const hasCondition = condition && hasValidValue(condition);

              const updateFieldCondition = (updates: Partial<FilterCondition>) => {
                const newConditions = [...localConditions];
                const index = newConditions.findIndex((c) => c.field === field.key);
                if (index >= 0) {
                  newConditions[index] = { ...newConditions[index], ...updates };
                } else {
                  newConditions.push({
                    field: field.key,
                    operator: operators[0].value,
                    value: '',
                    ...updates,
                  });
                }
                setLocalConditions(newConditions);
              };

              const isNoVal = isNoValueOperator(currentOperator);
              const isBetween = currentOperator === 'between';

              const getInputType = () => {
                if (['number', 'currency', 'percentage'].includes(field.dataType)) return 'number';
                if (field.dataType === 'date') return 'date';
                if (field.dataType === 'time') return 'time'; 
                if (field.dataType === 'datetime') return 'datetime-local';
                return 'text';
              };

              return (
                <div key={field.key} className="filter-row-container">
                  <div className="filter-row-header" onClick={() => toggleField(field.key)}>
                    <span className={`filter-row-title ${hasCondition ? 'active' : ''}`}>
                      {field.label}
                    </span>
                    <div className="filter-row-status" onClick={(e) => e.stopPropagation()}>
                      {isExpanded && (
                        <div style={{ width: 140 }}>
                          <Select
                            options={operators}
                            value={currentOperator}
                            onChange={(val) => {
                              // If switching to between, convert value to object
                              const valToObj = val === 'between' ? { from: '', to: '' } : '';
                              updateFieldCondition({
                                operator: val as FilterOperator,
                                value: valToObj,
                              });
                            }}
                            minWidth={140}
                            fullWidth={true}
                            buttonStyle={{
                              height: 26,
                              padding: '0 8px',
                              fontSize: 12,
                              border: 'none',
                              background: 'transparent',
                            }}
                          />
                        </div>
                      )}
                      {hasCondition && <Check size={14} className="condition-indicator" />}
                      <button
                        type="button"
                        className="filter-row-toggle-btn"
                        onClick={() => toggleField(field.key)}
                      >
                        <ChevronDown size={16} className={`chevron ${isExpanded ? 'open' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && !isNoVal && (
                    <div className="filter-row-body">
                      <div
                        className="filter-row-input-wrapper"
                        style={{ display: 'flex', gap: '8px' }}
                      >
                        {field.dataType === 'select' || field.dataType === 'radio' ? (
                          <Select
                            options={
                              field.options?.map((o) => ({
                                label: o.label,
                                value: o.value.toString(),
                              })) || []
                            }
                            value={(condition?.value as string | number)?.toString() || ''}
                            onChange={(val) => updateFieldCondition({ value: val })}
                            placeholder="- Select -"
                            buttonStyle={{ height: 32, fontSize: 13, flex: 1 }}
                          />
                        ) : field.dataType === 'boolean' ? (
                          <Select
                            options={[
                              { label: 'Yes', value: 'true' },
                              { label: 'No', value: 'false' },
                            ]}
                            value={
                              condition?.value === true
                                ? 'true'
                                : condition?.value === false
                                  ? 'false'
                                  : ''
                            }
                            onChange={(val) => updateFieldCondition({ value: val === 'true' })}
                            placeholder="- Select -"
                            buttonStyle={{ height: 32, fontSize: 13, flex: 1 }}
                          />
                        ) : field.dataType === 'multi_select' ? (
                          <input
                            type="text"
                            className="filter-row-input"
                            placeholder={`Enter comma-separated values...`}
                            value={(condition?.value as string) || ''}
                            onChange={(e) => updateFieldCondition({ value: e.target.value })}
                          />
                        ) : isBetween ? (
                          <>
                            <input
                              type={getInputType()}
                              className="filter-row-input"
                              placeholder="From..."
                              value={
                                (condition?.value as { from?: string; to?: string })?.from || ''
                              }
                              onChange={(e) =>
                                updateFieldCondition({
                                  value: {
                                    ...((condition?.value as { from?: string; to?: string }) || {}),
                                    from: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type={getInputType()}
                              className="filter-row-input"
                              placeholder="To..."
                              value={(condition?.value as { from?: string; to?: string })?.to || ''}
                              onChange={(e) =>
                                updateFieldCondition({
                                  value: {
                                    ...((condition?.value as { from?: string; to?: string }) || {}),
                                    to: e.target.value,
                                  },
                                })
                              }
                            />
                          </>
                        ) : (
                          <input
                            type={getInputType()}
                            className="filter-row-input"
                            placeholder={`Search by ${field.label.toLowerCase()}...`}
                            value={(condition?.value as string | number) || ''}
                            onChange={(e) => updateFieldCondition({ value: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="filter-footer">
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
