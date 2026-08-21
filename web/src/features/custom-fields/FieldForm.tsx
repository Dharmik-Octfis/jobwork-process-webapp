import { useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { CustomFieldInput } from './CustomFieldInput';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import {
  useCreateCustomField,
  useUpdateCustomField,
  type CreateFieldPayload,
} from './customFields.api';
import {
  DATA_TYPE_OPTIONS,
  generateOptionId,
  typeHasOptions,
  type CustomFieldConfig,
  type CustomFieldDefinition,
  type CustomFieldOption,
  type DataType,
} from './customFields.schemas';

interface Props {
  orgId: string;
  entityType: string;
  moduleLabel: string;
  fieldToEdit: CustomFieldDefinition | null;
  onDone: () => void;
  onCancel: () => void;
}

interface OptionDraft {
  id: string;
  label: string;
}

const labelCol: React.CSSProperties = { fontSize: 13, color: '#374151', paddingTop: 8 };
const requiredCol: React.CSSProperties = { ...labelCol, color: '#dc2626' };
const input: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  padding: '7px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '200px 1fr',
  alignItems: 'start',
  columnGap: 16,
  marginBottom: 20,
};

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 20, paddingTop: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input type="radio" checked={value} onChange={() => onChange(true)} /> Yes
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input type="radio" checked={!value} onChange={() => onChange(false)} /> No
      </label>
    </div>
  );
}

// Mounted only while adding/editing and remounted (via a key) when the target field
// changes, so useState initializers reflect current props — no props→state effect.
export function FieldForm({
  orgId,
  entityType,
  moduleLabel,
  fieldToEdit,
  onDone,
  onCancel,
}: Props) {
  const isEdit = !!fieldToEdit;
  const createMutation = useCreateCustomField(orgId, entityType);
  const updateMutation = useUpdateCustomField(orgId, entityType);

  const cfg = fieldToEdit?.config ?? {};
  const [fieldLabel, setFieldLabel] = useState(fieldToEdit?.label ?? '');
  const [dataType, setDataType] = useState<DataType>(fieldToEdit?.dataType ?? 'text');
  const [helpText, setHelpText] = useState(cfg.helpText ?? '');
  const [options, setOptions] = useState<OptionDraft[]>(
    (cfg.options ?? []).map((o) => ({ id: o.id, label: o.label })),
  );
  const [maxLength, setMaxLength] = useState(cfg.maxLength != null ? String(cfg.maxLength) : '');
  const [minVal, setMinVal] = useState(cfg.min != null ? String(cfg.min) : '');
  const [maxVal, setMaxVal] = useState(cfg.max != null ? String(cfg.max) : '');
  const [precision, setPrecision] = useState(cfg.precision != null ? String(cfg.precision) : '');
  const [defaultValue, setDefaultValue] = useState<unknown>(cfg.defaultValue);
  const [isRequired, setIsRequired] = useState(fieldToEdit?.isRequired ?? false);
  const [showInList, setShowInList] = useState(fieldToEdit?.showInList ?? false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const needsOptions = typeHasOptions(dataType);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const cleanedOptions = (): CustomFieldOption[] =>
    options
      .map((o, i) => ({ id: o.id, label: o.label.trim(), order: i }))
      .filter((o) => o.label.length > 0);

  // A synthetic definition so the Default Value control renders exactly like the
  // real field would on a record form.
  const draftDef: CustomFieldDefinition = {
    id: 'draft',
    key: '__default__',
    label: fieldLabel || 'Default',
    dataType,
    config: { options: cleanedOptions() },
    isRequired: false,
    showInPrint: false,
    showInList: false,
    displayOrder: 0,
  };

  const buildConfig = (): CustomFieldConfig => {
    const config: CustomFieldConfig = {};
    if (helpText.trim()) config.helpText = helpText.trim();
    if (needsOptions) config.options = cleanedOptions();
    if ((dataType === 'text' || dataType === 'textarea') && maxLength) {
      config.maxLength = Number(maxLength);
    }
    if (dataType === 'number' || dataType === 'decimal') {
      if (minVal !== '') config.min = Number(minVal);
      if (maxVal !== '') config.max = Number(maxVal);
    }
    if (dataType === 'decimal' && precision !== '') config.precision = Number(precision);
    const emptyDefault =
      defaultValue === undefined ||
      defaultValue === '' ||
      (Array.isArray(defaultValue) && defaultValue.length === 0);
    if (!emptyDefault) config.defaultValue = defaultValue;
    return config;
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...options];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOptions(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!fieldLabel.trim()) {
      setErrorMsg('Field name is required.');
      return;
    }
    if (needsOptions && cleanedOptions().length === 0) {
      setErrorMsg('Add at least one option.');
      return;
    }
    try {
      if (isEdit && fieldToEdit) {
        await updateMutation.mutateAsync({
          id: fieldToEdit.id,
          data: {
            label: fieldLabel.trim(),
            config: buildConfig(),
            isRequired,
            showInList,
          },
        });
      } else {
        const payload: CreateFieldPayload = {
          entityType,
          label: fieldLabel.trim(),
          dataType,
          config: buildConfig(),
          isRequired,
          showInList,
        };
        await createMutation.mutateAsync(payload);
      }
      onDone();
    } catch (err) {
      const e2 = err as { response?: { data?: { message?: string; error?: string } } };
      setErrorMsg(
        e2.response?.data?.message ?? e2.response?.data?.error ?? 'Could not save the field.',
      );
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 760 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 24px' }}>
        {isEdit ? 'Edit Field' : 'New Field'} — {moduleLabel}
      </h2>

      <form onSubmit={handleSubmit}>
        <div style={rowStyle}>
          <label style={{ ...labelCol, color: '#ef4444' }}>Field Name*</label>
          <input
            value={fieldLabel}
            onChange={(e) => setFieldLabel(e.target.value)}
            placeholder="e.g. Truck Number"
            style={input}
            autoFocus
          />
        </div>

        <div style={rowStyle}>
          <label style={{ ...labelCol, color: '#ef4444' }}>Data Type*</label>
          <div>
            <SearchableSelect
              options={DATA_TYPE_OPTIONS.map((t) => ({
                label: t.label,
                value: t.value,
                disabled: t.disabled,
              }))}
              value={dataType}
              disabled={isEdit}
              placeholder="Select a data type"
              style={{ maxWidth: 440 }}
              onChange={(val) => {
                setDataType(val as DataType);
                setDefaultValue(undefined);
              }}
            />
            {isEdit && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                Type can't change — archive this field and create a new one instead.
              </div>
            )}
          </div>
        </div>

        <div style={rowStyle}>
          <label style={labelCol}>Help Text</label>
          <div>
            <textarea
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              rows={2}
              style={{ ...input, resize: 'vertical' }}
            />
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Shown under the field to help users understand its purpose.
            </div>
          </div>
        </div>

        {/* Text length */}
        {(dataType === 'text' || dataType === 'textarea') && (
          <div style={rowStyle}>
            <label style={labelCol}>Max Length</label>
            <input
              type="number"
              min={1}
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
              placeholder="e.g. 100"
              style={{ ...input, maxWidth: 160 }}
            />
          </div>
        )}

        {/* Number / decimal constraints */}
        {(dataType === 'number' || dataType === 'decimal') && (
          <div style={rowStyle}>
            <label style={labelCol}>Range</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
                placeholder="Min"
                style={{ ...input, maxWidth: 120 }}
              />
              <span style={{ color: '#94a3b8' }}>–</span>
              <input
                type="number"
                value={maxVal}
                onChange={(e) => setMaxVal(e.target.value)}
                placeholder="Max"
                style={{ ...input, maxWidth: 120 }}
              />
              {dataType === 'decimal' && (
                <>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>
                    Decimal places
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={precision}
                    onChange={(e) => setPrecision(e.target.value)}
                    placeholder="2"
                    style={{ ...input, maxWidth: 80 }}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Options editor for dropdown / multi-select */}
        {needsOptions && (
          <div style={rowStyle}>
            <label style={requiredCol}>
              {dataType === 'multi_select' ? 'Multiselect Options' : 'Dropdown Options'}
            </label>
            <div
              style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, maxWidth: 520 }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <strong style={{ fontSize: 13, color: '#334155' }}>
                  Options Count : {options.length}
                </strong>
                <button
                  type="button"
                  onClick={() => setOptions([...options, { id: generateOptionId(), label: '' }])}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-primary)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={15} /> Add Option
                </button>
              </div>

              {options.map((opt, i) => (
                <div
                  key={opt.id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) reorder(dragIndex, i);
                    setDragIndex(null);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
                >
                  <GripVertical
                    size={16}
                    color="#94a3b8"
                    style={{ cursor: 'grab', flexShrink: 0 }}
                  />
                  <input
                    value={opt.label}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...next[i], label: e.target.value };
                      setOptions(next);
                    }}
                    placeholder={`Option ${i + 1}`}
                    style={{ ...input, maxWidth: 'none', flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#dc2626',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {options.length === 0 && (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  No options yet — add one above.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Default value — rendered with the same control the field will use */}
        {dataType !== 'attachment' && (
          <div style={rowStyle}>
            <label style={labelCol}>Default Value</label>
            {/* Portalled: this preview sits in the page's `overflow: auto` pane,
                which clips an absolutely-positioned calendar. */}
            <CustomFieldInput
              def={draftDef}
              value={defaultValue}
              onChange={setDefaultValue}
              portal
            />
          </div>
        )}

        <div style={rowStyle}>
          <label style={labelCol}>Is Mandatory</label>
          <YesNo value={isRequired} onChange={setIsRequired} />
        </div>

        <div style={rowStyle}>
          <label style={labelCol}>Show in List View</label>
          <YesNo value={showInList} onChange={setShowInList} />
        </div>

        {errorMsg && (
          <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{errorMsg}</div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            disabled={isSaving}
            style={{
              padding: '9px 22px',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '9px 22px',
              background: '#fff',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
