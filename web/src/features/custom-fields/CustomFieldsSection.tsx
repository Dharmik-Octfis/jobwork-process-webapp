import { Fragment, useEffect, useRef } from 'react';
import { useActiveCustomFields } from './customFields.api';
import { CustomFieldInput } from './CustomFieldInput';
import type { CustomFieldValues } from './customFields.schemas';

interface Props {
  orgId: string;
  entityType: string;
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
  /** Server-returned per-field errors, keyed by `customFields.<key>`. */
  errors?: Record<string, string>;
  /** On a NEW record, pre-fill fields that have a configured default value. */
  applyDefaults?: boolean;
  /**
   * `rows` (default) is the two-column label/control list the tabbed record forms
   * use, where the section owns a whole tab and has the room.
   *
   * `grid` is for a section sharing a scrolling page with others: the caption goes
   * ABOVE its control and the fields wrap into as many columns as fit, so four
   * fields cost one row instead of four. It matches the surrounding sections
   * rather than the tab, which is the point — see `JobOrderForm`.
   */
  layout?: 'rows' | 'grid';
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: '#111',
  fontSize: 13,
};

/** Caption above its control, matching the surrounding page's field captions. */
const stackedLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
};

/**
 * Renders an org's ACTIVE custom fields on a record (vendor/item) form. Fully
 * controlled: the parent owns the `values` object and receives updates so the
 * fields submit alongside the record's fixed fields.
 */
export function CustomFieldsSection({
  orgId,
  entityType,
  values,
  onChange,
  errors,
  applyDefaults,
  layout = 'rows',
}: Props) {
  const { data: fields = [], isLoading } = useActiveCustomFields(orgId, entityType);

  // Seed configured default values once, for a new record only. Runs after the
  // definitions load; `onChange` is the parent's setter (a prop), guarded to fire once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!applyDefaults || seededRef.current || fields.length === 0) return;
    seededRef.current = true;
    let changed = false;
    const merged: CustomFieldValues = { ...values };
    for (const def of fields) {
      if (!(def.key in merged) && def.config?.defaultValue !== undefined) {
        merged[def.key] = def.config.defaultValue;
        changed = true;
      }
    }
    if (changed) onChange(merged);
  }, [applyDefaults, fields, values, onChange]);

  if (isLoading) {
    return <div style={{ padding: 24, color: '#888', fontSize: 13 }}>Loading fields…</div>;
  }

  if (fields.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
        No custom fields yet. An organization admin can add them under
        <br />
        <strong>Settings → Modules</strong>.
      </div>
    );
  }

  const setField = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  if (layout === 'grid') {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          fontSize: '13px',
          alignItems: 'start',
        }}
      >
        {fields.map((def) => (
          <div key={def.id}>
            <label
              style={
                def.isRequired ? { ...stackedLabelStyle, color: '#ef4444' } : stackedLabelStyle
              }
            >
              {def.label}
              {def.isRequired && '*'}
            </label>
            <CustomFieldInput
              def={def}
              value={values[def.key]}
              onChange={(v) => setField(def.key, v)}
              error={errors?.[`customFields.${def.key}`]}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        rowGap: '20px',
        columnGap: '16px',
        fontSize: '13px',
        alignItems: 'center',
      }}
    >
      {fields.map((def) => (
        <Fragment key={def.id}>
          <label style={def.isRequired ? { ...labelStyle, color: '#ef4444' } : labelStyle}>
            {def.label}
            {def.isRequired && '*'}
          </label>
          <CustomFieldInput
            def={def}
            value={values[def.key]}
            onChange={(v) => setField(def.key, v)}
            error={errors?.[`customFields.${def.key}`]}
          />
        </Fragment>
      ))}
    </div>
  );
}
