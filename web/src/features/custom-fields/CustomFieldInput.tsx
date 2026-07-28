import type { CustomFieldDefinition } from './customFields.schemas';
import { Select } from '../../components/ui/Select';

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '440px',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
};

/** ISO datetime (stored) -> value for <input type="datetime-local"> in local time. */
function isoToLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

interface Props {
  def: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

/** Renders exactly one control for a custom field, driven by its dataType. */
export function CustomFieldInput({ def, value, onChange, error }: Props) {
  const options = def.config?.options ?? [];

  let control: React.ReactNode;

  switch (def.dataType) {
    case 'textarea':
      control = (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      );
      break;

    case 'checkbox':
      control = (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;

    case 'number':
    case 'decimal':
      control = (
        <input
          type="number"
          step={def.dataType === 'decimal' ? 'any' : '1'}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
          style={inputStyle}
        />
      );
      break;

    case 'date':
      control = (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
      break;

    case 'datetime':
      control = (
        <input
          type="datetime-local"
          value={isoToLocalInput(value)}
          onChange={(e) => onChange(localInputToIso(e.target.value))}
          style={inputStyle}
        />
      );
      break;

    case 'time':
      control = (
        <input
          type="time"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
      break;

    case 'email':
      control = (
        <input
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
      break;

    case 'url':
      control = (
        <input
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          style={inputStyle}
        />
      );
      break;

    case 'select':
      control = (
        <Select
          value={(value as string) ?? ''}
          onChange={(val) => onChange(val)}
          options={[
            { value: '', label: 'Select…' },
            ...options.map((o) => ({ value: o.id, label: o.label })),
          ]}
          buttonStyle={{ maxWidth: '440px' }}
        />
      );
      break;

    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 440 }}>
          {options.map((o) => (
            <label
              key={o.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o.id]
                    : selected.filter((id) => id !== o.id);
                  onChange(next);
                }}
              />
              {o.label}
            </label>
          ))}
          {options.length === 0 && <span style={{ color: '#888', fontSize: 12 }}>No options</span>}
        </div>
      );
      break;
    }

    case 'attachment':
      control = <span style={{ color: '#888', fontSize: 12 }}>Attachments are coming soon.</span>;
      break;

    case 'text':
    case 'phone':
    default:
      control = (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
  }

  return (
    <div>
      {control}
      {def.config?.helpText && (
        <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
          {def.config.helpText}
        </div>
      )}
      {error && <div style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>{error}</div>}
    </div>
  );
}
