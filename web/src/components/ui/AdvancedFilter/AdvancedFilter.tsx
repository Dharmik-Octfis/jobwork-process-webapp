import { useState, useRef,} from 'react';
import { Filter, Check, ChevronDown } from 'lucide-react';
import { Select } from '../Select';
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

export type FilterDataType = 'string' | 'number' | 'date' | 'boolean' | 'select' | 'time';

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

interface AdvancedFilterProps {
  fields: FilterField[];
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  matchType?: 'any' | 'all';
  onMatchTypeChange?: (matchType: 'any' | 'all') => void;
  align?: 'left' | 'right';
  leftOffset?: number;
}

const getOperatorsForType = (type: FilterDataType): { value: FilterOperator; label: string }[] => {
  switch (type) {
    case 'number':
    case 'date':
    case 'time':
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
    case 'select':
      return [
        { value: 'equals', label: 'Is' },
        { value: 'not_equals', label: 'Is Not' },
        { value: 'is_empty', label: 'Is Empty' },
        { value: 'is_not_empty', label: 'Is Not Empty' },
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
      localConditions.forEach(c => {
        if ((c.value !== '' && c.value != null) || ['is_empty', 'is_not_empty'].includes(c.operator)) {
          active.add(c.field);
        }
      });
      setExpandedFields(active);
    }
    setIsOpen(!isOpen);
  };

  const containerRef = useRef<HTMLDivElement>(null);

  // Intentionally removed handleClickOutside so the filter
  // only closes when explicitly closed via Cancel/Find/Reset.

  const handleApply = () => {
    const active = localConditions.filter((c) => {
      if (['is_empty', 'is_not_empty'].includes(c.operator)) return true;
      return c.value !== '' && c.value !== null && c.value !== undefined;
    });
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
            ...(align === 'left' ? { left: leftOffset, right: 'auto' } : { right: 0, left: 'auto' })
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
              const hasCondition = condition && (condition.value !== '' && condition.value != null || ['is_empty', 'is_not_empty'].includes(condition.operator));

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

              const isNoValueOperator = ['is_empty', 'is_not_empty'].includes(currentOperator);

              return (
                <div key={field.key} className="filter-row-container">
                  <div className="filter-row-header" onClick={() => toggleField(field.key)}>
                    <span className={`filter-row-title ${hasCondition ? 'active' : ''}`}>{field.label}</span>
                    <div className="filter-row-status" onClick={(e) => e.stopPropagation()}>
                      {isExpanded && (
                        <div style={{ width: 140 }}>
                          <Select
                            options={operators}
                            value={currentOperator}
                            onChange={(val) => updateFieldCondition({ operator: val as FilterOperator })}
                            minWidth={140}
                            fullWidth={true}
                            buttonStyle={{ height: 26, padding: '0 8px', fontSize: 12, border: 'none', background: 'transparent' }}
                          />
                        </div>
                      )}
                      {hasCondition && <Check size={14} className="condition-indicator" />}
                      <button type="button" className="filter-row-toggle-btn" onClick={() => toggleField(field.key)}>
                        <ChevronDown size={16} className={`chevron ${isExpanded ? 'open' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && !isNoValueOperator && (
                    <div className="filter-row-body">
                      <div className="filter-row-input-wrapper">
                        {field.dataType === 'select' ? (
                          <Select
                            options={field.options?.map(o => ({ label: o.label, value: o.value.toString() })) || []}
                            value={(condition?.value as string | number)?.toString() || ''}
                            onChange={(val) => updateFieldCondition({ value: val })}
                            placeholder="- Select -"
                            buttonStyle={{ height: 32, fontSize: 13 }}
                          />
                        ) : field.dataType === 'boolean' ? (
                          <Select
                            options={[
                              { label: 'True', value: 'true' },
                              { label: 'False', value: 'false' },
                            ]}
                            value={condition?.value === true ? 'true' : condition?.value === false ? 'false' : ''}
                            onChange={(val) => updateFieldCondition({ value: val === 'true' })}
                            placeholder="- Select -"
                            buttonStyle={{ height: 32, fontSize: 13 }}
                          />
                        ) : (
                          <input
                            type={field.dataType === 'number' ? 'number' : field.dataType === 'date' ? 'date' : field.dataType === 'time' ? 'time' : 'text'}
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
