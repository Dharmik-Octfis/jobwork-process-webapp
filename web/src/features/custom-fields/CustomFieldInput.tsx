import { TEXT_LENGTH_CAPS, type CustomFieldDefinition } from './customFields.schemas';
import { DateInput } from '../../components/ui/DateInput';
import { DateTimeInput } from '../../components/ui/DateTimeInput';
import { Select } from '../../components/ui/Select';

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '440px',
  padding: '8px 12px',
  height: '36px',
  fontSize: '13px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  boxSizing: 'border-box',
};

const ERROR_BORDER = '1px solid #ef4444';

// A frame, not an outline on the box itself — that would replace the focus ring.
const checkboxErrorFrame: React.CSSProperties = {
  display: 'inline-flex',
  padding: 2,
  border: ERROR_BORDER,
  borderRadius: 4,
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
  /** Marks the field invalid: a red border, never text. The caller toasts the message. */
  error?: string;
  /** Portal the date calendar out — see `DateInput`. Needed when this renders
   * inside a `Modal` or any other clipping scroll container. */
  portal?: boolean;
}

/** Renders exactly one control for a custom field, driven by its dataType. */
export function CustomFieldInput({ def, value, onChange, error, portal = false }: Props) {
  const options = def.config?.options ?? [];
  const hasError = Boolean(error);
  // The shared date/time controls merge `style` last, so the red border has to
  // travel in it — `hasError` alone would lose to inputStyle's grey one.
  const fieldStyle = hasError ? { ...inputStyle, border: ERROR_BORDER } : inputStyle;
  const ariaInvalid = hasError || undefined;
  // Stops typing at the limit the server enforces, instead of failing on Save.
  const maxLength = TEXT_LENGTH_CAPS[def.dataType];

  let control: React.ReactNode;

  switch (def.dataType) {
    case 'textarea':
      control = (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={3}
          style={{ ...fieldStyle, resize: 'vertical', height: 'auto' }}
          aria-invalid={ariaInvalid}
        />
      );
      break;

    case 'checkbox':
      control = (
        <span style={hasError ? checkboxErrorFrame : undefined}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={ariaInvalid}
          />
        </span>
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
          style={fieldStyle}
          aria-invalid={ariaInvalid}
        />
      );
      break;

    case 'date':
      control = (
        <DateInput
          value={(value as string) ?? ''}
          onChange={onChange}
          ariaLabel={def.label}
          style={fieldStyle}
          hasError={hasError}
          containerStyle={{ maxWidth: 440 }}
          portal={portal}
          defaultToCurrent={true}
        />
      );
      break;

    case 'datetime':
      control = (
        <DateInput
          type="datetime"
          value={isoToLocalInput(value)}
          onChange={(val) => onChange(localInputToIso(val))}
          style={fieldStyle}
          hasError={hasError}
          containerStyle={{ maxWidth: 440 }}
          portal={portal}
          defaultToCurrent={true}
        />
      );
      break;

    case 'time':
      control = (
        <DateTimeInput
          type="time"
          value={(value as string) ?? ''}
          onChange={(val) => onChange(val)}
          style={fieldStyle}
          hasError={hasError}
          defaultToCurrent={true}
        />
      );
      break;

    case 'email':
      control = (
        <input
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          style={fieldStyle}
          aria-invalid={ariaInvalid}
        />
      );
      break;

    case 'url':
      control = (
        <input
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          placeholder="https://…"
          style={fieldStyle}
          aria-invalid={ariaInvalid}
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
          portal={portal}
          hasError={hasError}
          containerStyle={{ maxWidth: '440px' }}
          buttonStyle={{ height: '36px' }}
        />
      );
      break;

    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div
          role="group"
          aria-invalid={ariaInvalid}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxWidth: 440,
            ...(hasError ? { border: ERROR_BORDER, borderRadius: 4, padding: '6px 8px' } : {}),
          }}
        >
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

    case 'text':
    case 'phone':
    default:
      control = (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          style={fieldStyle}
          aria-invalid={ariaInvalid}
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
    </div>
  );
}
