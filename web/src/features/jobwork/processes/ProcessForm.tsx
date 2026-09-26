import { useForm } from 'react-hook-form';
import type { CreateProcessData, Process } from './processes.schemas';

export interface ProcessFormProps {
  initialData?: Partial<Process>;
  onSubmit: (data: CreateProcessData) => void;
  isPending: boolean;
  onCancel: () => void;
  formId?: string;
  hideFooter?: boolean;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#4b5563',
  fontWeight: 500,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  height: 36,
  boxSizing: 'border-box' as const,
};

const errorStyle: React.CSSProperties = {
  color: '#e54d4d',
  fontSize: 11,
  display: 'block',
  marginTop: 4,
};

/**
 * One form, used by both Create and Edit.
 *
 * Every control here is a native `input`, `textarea`, `button` or the shared
 * `Select` — nothing is a `<div onClick>`. That is not stylistic: Tab walks
 * straight past a clickable div, so the control is simply unreachable by
 * keyboard, and neither `tsc -b` nor a screenshot says a word about it
 * (CLAUDE.md). DOM order is also tab order here — the fields are one column, so
 * the two cannot silently diverge the way they do in a multi-column grid.
 */
export function ProcessForm({ initialData, onSubmit, isPending, onCancel, formId, hideFooter }: ProcessFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateProcessData>({
    defaultValues: {
      name: initialData?.name ?? '',
      code: initialData?.code ?? '',
      description: initialData?.description ?? '',
      itemChanges: initialData?.itemChanges ?? false,
    },
  });

  const submit = (data: CreateProcessData) => {
    onSubmit({
      ...data,
      code: data.code?.trim() || null,
      description: data.description?.trim() || null,
    });
  };

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.stopPropagation();
        handleSubmit(submit)(e);
      }}
      noValidate
      // 200px padding ensures that the form can be scrolled high enough for the
      // dropdowns at the bottom (like the ItemComboBox) to open downwards without
      // being clipped by the window's bottom edge or overlapping the fixed action bar.
      style={hideFooter ? { padding: '8px 0' } : { padding: '24px 32px', paddingBottom: 200 }}
    >
      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, color: '#ef4444' }} htmlFor="process-name">
            Process Name*
          </label>
          <input
            id="process-name"
            type="text"
            {...register('name', { required: 'Process name is required' })}
            style={inputStyle}
            placeholder="Dyeing"
            autoFocus
          />
          {errors.name && <span style={errorStyle}>{errors.name.message}</span>}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-code">
            Code
          </label>
          <input
            id="process-code"
            type="text"
            {...register('code')}
            style={inputStyle}
            placeholder="DYE"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-description">
            Description
          </label>
          <textarea
            id="process-description"
            {...register('description')}
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            placeholder="What this operation does to the material"
          />
        </div>
      </section>

      <section style={{ maxWidth: 640, marginBottom: hideFooter ? 0 : 32 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#111',
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Behaviour
        </h2>

        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            marginBottom: hideFooter ? 0 : 16,
            cursor: 'pointer',
          }}
        >
          <input type="checkbox" {...register('itemChanges')} style={{ marginTop: 3 }} />
          <span>
            <strong style={{ fontSize: 13, color: '#111' }}>The item changes</strong>
          </span>
        </label>
      </section>

      {/*
        ⚠️ The "Defaults" section is gone. "Default Issue Unit" and "Default
        Receive Unit" went first: a step transacts in its ITEMS' stocking units
        (§5.1), so an org-wide default was a guess about one item. "Rate Basis"
        went with the landed-cost redesign — the charge is rate × accepted on
        each output row of the job order.

        The Custom Fields section went too: `process` left ENTITY_TYPES, because
        the operation master is a short list of names an org types once and
        per-org fields on it were a section nobody filled in.
      */}

      {!hideFooter && (
        <div
          className="form-actions-footer"
          style={{
            height: 44,
            boxSizing: 'border-box',
            position: 'fixed',
            bottom: 0,
            // 250, not 220: this form renders inside SettingsLayout, whose sidebar is
            // wider than the main one.
            left: 250,
            right: 0,
            background: '#fff',
            padding: '0 24px',
            borderTop: '1px solid #eef0f3',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 100,
          }}
        >
          <button
            type="submit"
            disabled={isPending}
            style={{
              padding: '6px 20px',
              background: '#0062ff',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 20px',
              background: 'white',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </form>
  );
}
